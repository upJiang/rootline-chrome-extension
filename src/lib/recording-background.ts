import { ensureRootlineOffscreenDocument } from "./offscreen"
import {
  RECORDING_ACTIVE_STORAGE_KEY,
  RECORDING_MAX_DURATION_ALARM,
  type ActiveRecordingRuntime,
  type OffscreenRecordingEndedMessage,
  type OffscreenRecordingResult,
} from "./recording-messages"
import { deleteRecordingResult, readRecordingResult } from "./recording-result-store"
import { mutateSession, readSession } from "./storage"
import type { RecordingEvidence, RootlineSession } from "./types"

interface StartRecordingResponse {
  active: boolean
  resultId?: string
  startedAt?: number
}

interface RecordingStatusResponse {
  active: boolean
  resultId?: string
  startedAt?: number
}

let stopPromise: Promise<RootlineSession> | null = null

async function offscreenRequest<T>(message: object): Promise<T> {
  await ensureRootlineOffscreenDocument()
  const response = await chrome.runtime.sendMessage(message)
  if (!response?.ok) throw new Error(response?.error ?? "后台录屏执行失败。")
  return response.data as T
}

export async function readActiveRecording(): Promise<ActiveRecordingRuntime | null> {
  const stored = await chrome.storage.local.get(RECORDING_ACTIVE_STORAGE_KEY)
  const value = stored[RECORDING_ACTIVE_STORAGE_KEY] as Partial<ActiveRecordingRuntime> | undefined
  if (!value || typeof value.sessionId !== "string" || typeof value.tabId !== "number" || typeof value.startedAt !== "string" || typeof value.maxDurationMs !== "number") return null
  return {
    sessionId: value.sessionId,
    tabId: value.tabId,
    pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : "正在录制的页面",
    startedAt: value.startedAt,
    maxDurationMs: value.maxDurationMs,
  }
}

export async function startSessionRecording(session: RootlineSession, maxDurationMs: number): Promise<RootlineSession> {
  const active = await readActiveRecording()
  if (active && active.sessionId !== session.id) throw new Error("已有 Rootline 录屏正在进行，请先停止当前录制。")
  if (session.recordingState?.status === "recording") return session

  const response = await offscreenRequest<StartRecordingResponse>({
    type: "ROOTLINE_OFFSCREEN_START_RECORDING",
    sessionId: session.id,
    maxDurationMs,
  })
  if (!response.active || !response.resultId || typeof response.startedAt !== "number") throw new Error("后台录屏没有成功启动。")
  try {
    const startedAt = new Date(response.startedAt).toISOString()
    const runtime: ActiveRecordingRuntime = {
      sessionId: session.id,
      tabId: session.tabId,
      pageTitle: session.page.title,
      startedAt,
      maxDurationMs,
    }
    await chrome.storage.local.set({ [RECORDING_ACTIVE_STORAGE_KEY]: runtime })
    await chrome.alarms.create(RECORDING_MAX_DURATION_ALARM, { delayInMinutes: maxDurationMs / 60_000 })
    await setRecordingBadge(true)
    const updated = await mutateSession(session.id, (current) => {
      current.captureMode = "video"
      current.recordingState = {
        resultId: response.resultId!,
        status: "recording",
        startedAt,
        maxDurationMs,
      }
    })
    if (!updated) throw new Error("录屏已经开始，但采集会话没有保存成功。")
    await notifyTab(updated)
    return updated
  } catch (error) {
    await offscreenRequest<OffscreenRecordingResult>({
      type: "ROOTLINE_OFFSCREEN_STOP_RECORDING",
      sessionId: session.id,
      discard: true,
      reason: "manual",
    }).catch(() => undefined)
    await clearActiveRecording()
    throw error
  }
}

export async function stopSessionRecording(
  sessionId: string,
  reason: "manual" | "timeout" | "sharing-ended" = "manual",
): Promise<RootlineSession> {
  if (stopPromise) return stopPromise
  stopPromise = stopSessionRecordingOnce(sessionId, reason)
  try {
    return await stopPromise
  } finally {
    stopPromise = null
  }
}

async function stopSessionRecordingOnce(
  sessionId: string,
  reason: "manual" | "timeout" | "sharing-ended",
): Promise<RootlineSession> {
  const session = await readSession(sessionId)
  if (!session) throw new Error("采集会话不存在或已经过期。")
  if (session.recording && session.recordingState?.status === "stopped") return session
  const response = await offscreenRequest<OffscreenRecordingResult>({
    type: "ROOTLINE_OFFSCREEN_STOP_RECORDING",
    sessionId,
    reason,
  })
  if (!response.stopped || !response.recording) {
    const stored = session.recordingState?.resultId
      ? await readRecordingResult(session.recordingState.resultId)
      : null
    if (stored) {
      return applyStoppedRecording(sessionId, {
        resultId: stored.id,
        fileName: "capture.webm",
        mimeType: stored.mimeType || stored.blob.type || "video/webm",
        startedAt: new Date(stored.startedAt).toISOString(),
        durationMs: stored.durationMs,
        sizeBytes: stored.blob.size,
        width: 1280,
        height: 720,
        frameCount: stored.frameQueue.length,
        keyframes: stored.frameQueue.map((frame) => ({
          offsetMs: frame.offsetMs,
          reason: frame.reason,
          ...(frame.label ? { label: frame.label } : {}),
        })),
      })
    }
    throw new Error("录屏结果没有成功保存到本地临时存储。")
  }
  return applyStoppedRecording(sessionId, response.recording)
}

export async function reconcileActiveRecording(): Promise<void> {
  const active = await readActiveRecording()
  if (!active) {
    await setRecordingBadge(false)
    return
  }
  const session = await readSession(active.sessionId)
  if (!session) {
    await offscreenRequest<OffscreenRecordingResult>({
      type: "ROOTLINE_OFFSCREEN_STOP_RECORDING",
      sessionId: active.sessionId,
      discard: true,
      reason: "manual",
    }).catch(() => undefined)
    await clearActiveRecording()
    return
  }
  const status = await offscreenRequest<RecordingStatusResponse>({
    type: "ROOTLINE_OFFSCREEN_RECORDING_STATUS",
    sessionId: active.sessionId,
  }).catch(() => ({ active: false }))
  if (!status.active) {
    const stored = session.recordingState?.resultId
      ? await readRecordingResult(session.recordingState.resultId)
      : null
    if (stored) {
      await stopSessionRecordingOnce(active.sessionId, "sharing-ended").catch(() => undefined)
    } else {
      const failed = await mutateSession(active.sessionId, (current) => {
        if (!current.recordingState) return
        current.recordingState = {
          ...current.recordingState,
          status: "failed",
          stoppedAt: new Date().toISOString(),
          error: "录屏进程已中断，请放弃本次采集后重新录制。",
        }
      })
      await clearActiveRecording()
      if (failed) await notifyTab(failed)
    }
    return
  }
  const elapsedMs = Math.max(0, Date.now() - Date.parse(active.startedAt))
  const remainingMs = active.maxDurationMs - elapsedMs
  if (remainingMs <= 0) {
    await stopRecordingAtLimit()
    return
  }
  await chrome.alarms.create(RECORDING_MAX_DURATION_ALARM, { delayInMinutes: remainingMs / 60_000 })
  await setRecordingBadge(true)
  await notifyTab(session)
}

export async function discardSessionRecording(session: RootlineSession): Promise<void> {
  if (session.recordingState?.status === "recording") {
    await offscreenRequest<OffscreenRecordingResult>({
      type: "ROOTLINE_OFFSCREEN_STOP_RECORDING",
      sessionId: session.id,
      discard: true,
      reason: "manual",
    }).catch(() => undefined)
  }
  const resultId = session.recording?.resultId ?? session.recordingState?.resultId
  if (resultId) await deleteRecordingResult(resultId).catch(() => undefined)
  const active = await readActiveRecording()
  if (active?.sessionId === session.id) await clearActiveRecording()
}

export async function markRecordingFrame(sessionId: string, label: string): Promise<void> {
  const active = await readActiveRecording()
  if (active?.sessionId !== sessionId) return
  await offscreenRequest({ type: "ROOTLINE_OFFSCREEN_MARK_FRAME", sessionId, label }).catch(() => undefined)
}

export async function handleOffscreenRecordingEnded(message: OffscreenRecordingEndedMessage): Promise<void> {
  if (message.recording) {
    await applyStoppedRecording(message.sessionId, message.recording)
    return
  }
  const session = await mutateSession(message.sessionId, (current) => {
    if (!current.recordingState) return
    current.recordingState = {
      ...current.recordingState,
      status: "failed",
      stoppedAt: new Date().toISOString(),
      error: message.error ?? "录屏已停止，但没有生成可用的视频文件。",
    }
  })
  await clearActiveRecording()
  if (session) await notifyTab(session)
}

export async function stopRecordingAtLimit(): Promise<void> {
  const active = await readActiveRecording()
  if (!active) return
  await stopSessionRecording(active.sessionId, "timeout").catch(async (error: unknown) => {
    await handleOffscreenRecordingEnded({
      type: "ROOTLINE_OFFSCREEN_RECORDING_ENDED",
      sessionId: active.sessionId,
      error: error instanceof Error ? error.message : "达到最长时长后停止录屏失败。",
    })
  })
}

export async function clearStoredRecordingResult(resultId: string): Promise<void> {
  await deleteRecordingResult(resultId)
}

async function applyStoppedRecording(sessionId: string, recording: RecordingEvidence): Promise<RootlineSession> {
  const session = await mutateSession(sessionId, (current) => {
    const state = current.recordingState
    current.recording = recording
    current.recordingState = {
      resultId: recording.resultId,
      status: "stopped",
      startedAt: recording.startedAt,
      maxDurationMs: state?.maxDurationMs ?? recording.durationMs,
      stoppedAt: new Date(Date.parse(recording.startedAt) + recording.durationMs).toISOString(),
    }
  })
  await clearActiveRecording()
  if (!session) throw new Error("录屏结果已生成，但采集会话不存在。")
  await notifyTab(session)
  return session
}

async function clearActiveRecording(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(RECORDING_ACTIVE_STORAGE_KEY),
    chrome.alarms.clear(RECORDING_MAX_DURATION_ALARM),
  ])
  await setRecordingBadge(false)
}

async function setRecordingBadge(recording: boolean): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: recording ? "#b42318" : "#64748b" })
  await chrome.action.setBadgeText({ text: recording ? "REC" : "" })
}

async function notifyTab(session: RootlineSession): Promise<void> {
  await chrome.tabs.sendMessage(session.tabId, {
    type: "ROOTLINE_RECORDING_STATE",
    recordingState: session.recordingState,
    recording: session.recording,
  }).catch(() => undefined)
}
