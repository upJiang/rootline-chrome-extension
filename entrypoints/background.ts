import { defineBackground } from "wxt/utils/define-background"
import type {
  ActiveState,
  ExtensionRequest,
  ExtensionResponse,
  OffscreenDownloadRequest,
  OffscreenRemoteSaveProgressMessage,
  OffscreenReexportRemoteRequest,
  OffscreenReexportRequest,
  OffscreenTestCosRequest,
  OffscreenWriteRemoteRequest,
  OffscreenWriteRequest,
  RuntimeSnapshotResponse,
  RuntimePrepareFinishResponse,
  RuntimeStartResponse,
  TabRuntimeRequest,
} from "../src/lib/messaging"
import { sanitizeNetworkEvidence, sanitizeTargetEvidence } from "../src/lib/capture/sanitize"
import { cleanupDownloads, downloadArtifact } from "../src/lib/download-artifacts"
import { ensureRootlineOffscreenDocument } from "../src/lib/offscreen"
import {
  clearStoredRecordingResult,
  discardSessionRecording,
  handleOffscreenRecordingEnded,
  markRecordingFrame,
  readActiveRecording,
  reconcileActiveRecording,
  startSessionRecording,
  stopRecordingAtLimit,
  stopSessionRecording,
} from "../src/lib/recording-background"
import { isOffscreenRecordingEndedMessage, RECORDING_MAX_DURATION_ALARM } from "../src/lib/recording-messages"
import { normalizeRecordingMaxDurationMs } from "../src/lib/recording-settings"
import { redactText, redactUrl, truncateText } from "../src/lib/redaction"
import { clearTencentCosConfig, normalizeTencentCosConfig, readCaptureSaveConfig, saveTencentCosConfig, setCaptureSaveMode } from "../src/lib/remote-config"
import { buildRemoteAiContext, buildReportMarkdown, createReport } from "../src/lib/report"
import {
  cleanExpiredSessions,
  mutateSession,
  readSession,
  readSessionForTab,
  removeSession,
  saveSession,
  summarizeSession,
} from "../src/lib/storage"
import {
  MAX_CONSOLE_EVENTS,
  MAX_NETWORK_EVENTS,
  MAX_TARGETS,
  REPORT_SCHEMA_VERSION,
  type ConsoleEvidence,
  type CaptureMode,
  type CaptureSaveMode,
  type NetworkEvidence,
  type PageInfo,
  type LocalArtifactLocation,
  type RemoteArtifactLocation,
  type RootlineReportV1,
  type RootlineSession,
  type TencentCosConfig,
} from "../src/lib/types"

const UNSUPPORTED_PAGE_MESSAGE = "Rootline 只能采集普通 HTTP/HTTPS 网页；Chrome 内部页、扩展商店和 PDF 不支持注入采集器。"

function supportedUrl(value?: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.pathname.toLowerCase().endsWith(".pdf")
  } catch {
    return false
  }
}

function initialPage(tab: chrome.tabs.Tab): PageInfo {
  const url = tab.url ?? ""
  return {
    url: redactUrl(url),
    title: redactText(tab.title ?? "未命名页面"),
    origin: (() => {
      try {
        return new URL(url).origin
      } catch {
        return ""
      }
    })(),
    viewport: { width: 0, height: 0, devicePixelRatio: 1 },
    userAgent: "等待页面采集器上报",
    language: "",
    capturedAt: new Date().toISOString(),
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab ?? null
}

async function injectRuntime(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["page-bridge.js"],
  })
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    files: ["page-runtime.js"],
  })
}

function createSession(tab: chrome.tabs.Tab, captureMode: CaptureMode = "screenshot", saveMode: CaptureSaveMode = "local"): RootlineSession {
  const now = new Date().toISOString()
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    tabId: tab.id as number,
    ...(typeof tab.windowId === "number" ? { windowId: tab.windowId } : {}),
    startedAt: now,
    updatedAt: now,
    status: "capturing",
    captureMode,
    saveMode,
    page: initialPage(tab),
    issue: { description: "", expectedResult: "", notes: "" },
    targets: [],
    console: [],
    network: [],
    limits: { consoleDropped: 0, networkDropped: 0, targetLimitReached: false },
    boundaries: [
      { code: "capture-window", message: "控制台和网络证据只覆盖用户主动开始采集后的时间窗口。" },
      { code: "privacy", message: "未采集 Cookie、本地存储、密码字段和浏览历史。" },
      { code: "frame-boundary", message: "跨域 iframe 与 closed shadow root 内部不可读取。" },
    ],
    screenshot: {},
  }
}

async function sendToTab<T>(tabId: number, message: TabRuntimeRequest): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T | undefined
  } catch {
    return undefined
  }
}

async function startSession(
  tabId: number,
  captureMode: CaptureMode = "screenshot",
  maxDurationMs?: number,
): Promise<RootlineSession> {
  const tab = await chrome.tabs.get(tabId)
  if (!supportedUrl(tab.url)) throw new Error(UNSUPPORTED_PAGE_MESSAGE)
  const existing = await readSessionForTab(tabId)
  if (existing && existing.status === "capturing") {
    if ((existing.captureMode ?? "screenshot") !== captureMode) throw new Error("当前页面已有另一种采集正在进行，请先完成或放弃。")
    await injectRuntime(tabId)
    const started = await sendToTab<RuntimeStartResponse>(tabId, {
      type: "ROOTLINE_START",
      sessionId: existing.id,
      startedAt: existing.startedAt,
      targets: existing.targets,
      captureMode: existing.captureMode ?? "screenshot",
      ...(existing.recordingState ? { recordingState: existing.recordingState } : {}),
      ...(existing.recording ? { recording: existing.recording } : {}),
    })
    if (!started?.ok || !started.visible) throw new Error("页面采集面板没有成功显示，请重试。")
    if (captureMode === "video" && existing.recordingState?.status !== "recording" && !existing.recording) {
      return startSessionRecording(existing, normalizeRecordingMaxDurationMs(maxDurationMs))
    }
    return existing
  }
  if (existing && ["reviewing", "exported"].includes(existing.status)) return existing
  const saveConfig = await readCaptureSaveConfig()
  if (saveConfig.mode === "remote" && !saveConfig.remote) throw new Error("请先配置腾讯云 COS。")
  const session = createSession(tab, captureMode, saveConfig.mode)
  await saveSession(session)
  try {
    await injectRuntime(tabId)
    const started = await sendToTab<RuntimeStartResponse>(tabId, {
      type: "ROOTLINE_START",
      sessionId: session.id,
      startedAt: session.startedAt,
      targets: [],
      captureMode,
    })
    if (!started?.ok || !started.visible) throw new Error("页面采集面板没有成功显示，请重试。")
  } catch (error) {
    await removeSession(session.id)
    throw new Error(error instanceof Error ? error.message : "无法向当前页面注入 Rootline 采集器。")
  }
  if (captureMode !== "video") return session
  try {
    return await startSessionRecording(session, normalizeRecordingMaxDurationMs(maxDurationMs))
  } catch (error) {
    await sendToTab(tabId, { type: "ROOTLINE_CLEANUP" })
    await removeSession(session.id)
    throw error
  }
}

async function reannotateSession(sessionId: string, senderTabId?: number): Promise<RootlineSession> {
  const previous = await readSession(sessionId)
  if (!previous || !["reviewing", "exported"].includes(previous.status)) {
    throw new Error("只有已完成的采集可以重新标注。")
  }
  if (typeof senderTabId === "number" && senderTabId !== previous.tabId) throw new Error("页面会话校验失败。")
  const tabId = previous.tabId
  const currentTab = await chrome.tabs.get(tabId)
  if (!supportedUrl(currentTab.url)) throw new Error(UNSUPPORTED_PAGE_MESSAGE)
  const saveConfig = await readCaptureSaveConfig()
  if (saveConfig.mode === "remote" && !saveConfig.remote) throw new Error("请先配置腾讯云 COS。")
  const session = createSession(currentTab, "screenshot", saveConfig.mode)
  await sendToTab(tabId, { type: "ROOTLINE_CLEANUP" })
  await saveSession(session)
  try {
    await injectRuntime(tabId)
    const started = await sendToTab<RuntimeStartResponse>(tabId, {
      type: "ROOTLINE_START",
      sessionId: session.id,
      startedAt: session.startedAt,
      targets: [],
      captureMode: "screenshot",
    })
    if (!started?.ok || !started.visible) throw new Error("页面采集面板没有成功显示，请重试。")
  } catch (error) {
    await removeSession(session.id)
    await saveSession(previous)
    // ROOTLINE_CLEANUP runs before the new session is started. If reconnecting
    // fails, restore the completed action panel so the user can retry without
    // being left with a blank page.
    await sendToTab(tabId, { type: "ROOTLINE_SHOW_COMPLETE", session: previous }).catch(() => undefined)
    throw new Error(error instanceof Error ? error.message : "无法重新连接当前页面。")
  }
  return session
}

async function writeSessionOffscreen(session: RootlineSession): Promise<{
  report: RootlineReportV1
  localLocation?: LocalArtifactLocation
  remoteLocation?: RemoteArtifactLocation
}> {
  await ensureRootlineOffscreenDocument()
  if (session.saveMode === "remote") {
    const saveConfig = await readCaptureSaveConfig()
    if (!saveConfig.remote) throw new Error("腾讯云 COS 配置不存在，请重新配置后重试。")
    const response = (await chrome.runtime.sendMessage({
      type: "OFFSCREEN_WRITE_REMOTE_SESSION",
      session,
      config: saveConfig.remote,
    } satisfies OffscreenWriteRemoteRequest)) as ExtensionResponse<{ report: RootlineReportV1; location: RemoteArtifactLocation }>
    if (!response?.ok || !response.data) throw new Error(response?.error ?? "腾讯云 COS 上传失败。")
    return { report: response.data.report, remoteLocation: response.data.location }
  }
  const response = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_WRITE_SESSION",
    session,
  } satisfies OffscreenWriteRequest)) as ExtensionResponse<{ report: RootlineReportV1; location: LocalArtifactLocation }>
  if (!response?.ok || !response.data) throw new Error(response?.error ?? "本地采集文件写入失败。")
  return { report: response.data.report, localLocation: response.data.location }
}

function mergeConsole(session: RootlineSession, events: ConsoleEvidence[]): void {
  for (const event of events) {
    if (session.console.some((item) => item.id === event.id)) continue
    if (session.console.length >= MAX_CONSOLE_EVENTS) {
      session.limits.consoleDropped += 1
      continue
    }
    session.console.push({
      ...event,
      message: truncateText(redactText(String(event.message ?? "")), 4 * 1024).value,
      ...(event.stack ? { stack: truncateText(redactText(event.stack), 4 * 1024).value } : {}),
    })
  }
}

function mergeNetwork(session: RootlineSession, events: NetworkEvidence[]): void {
  for (const event of events) {
    if (session.network.some((item) => item.id === event.id)) continue
    if (session.network.length >= MAX_NETWORK_EVENTS) {
      session.limits.networkDropped += 1
      continue
    }
    session.network.push(sanitizeNetworkEvidence(event))
  }
}

async function finishSession(sessionId: string): Promise<RootlineSession> {
  const beforeFinish = await readSession(sessionId)
  if (!beforeFinish) throw new Error("采集会话不存在或已经过期。")
  if (beforeFinish.captureMode === "video" && beforeFinish.recordingState?.status === "recording") {
    await stopSessionRecording(sessionId)
  }
  const recordingReady = await readSession(sessionId)
  if (recordingReady?.captureMode === "video" && !recordingReady.recording) {
    throw new Error(recordingReady.recordingState?.error ?? "本次录屏没有生成可用的视频，请重新录制。")
  }
  let finishError: Error | null = null
  let recordingResultToClear: string | null = null
  const session = await mutateSession(sessionId, async (current) => {
    const snapshot = await sendToTab<RuntimeSnapshotResponse>(current.tabId, { type: "ROOTLINE_CAPTURE_SNAPSHOT" })
    if (snapshot?.page) current.page = snapshot.page
    if (snapshot?.resources) mergeNetwork(current, snapshot.resources)
    if (snapshot?.targets) {
      const currentTargets = new Map(snapshot.targets.map((target) => [target.id, target]))
      current.targets = current.targets.map((target) => sanitizeTargetEvidence(currentTargets.get(target.id) ?? target))
    }
    if (!snapshot?.ok) {
      current.boundaries.push({ code: "snapshot-unavailable", message: "页面可能已刷新或关闭，结束时快照未能完整更新。" })
    }
    if (!current.issue.description.trim()) {
      const actualResult = current.targets
        .map((target, index) => target.annotation?.actualResult.trim() ? `元素 ${index + 1}：${target.annotation.actualResult.trim()}` : "")
        .filter(Boolean)
        .join("\n")
      current.issue.description = truncateText(redactText(actualResult), 2_000).value
    }
    if (!current.issue.expectedResult.trim()) {
      const expectedResult = current.targets
        .map((target, index) => target.annotation?.expectedResult.trim() ? `元素 ${index + 1}：${target.annotation.expectedResult.trim()}` : "")
        .filter(Boolean)
        .join("\n")
      current.issue.expectedResult = truncateText(redactText(expectedResult), 2_000).value
    }
    try {
      const prepared = await sendToTab<RuntimePrepareFinishResponse>(current.tabId, { type: "ROOTLINE_PREPARE_FINISH" })
      if (!prepared?.ok || !prepared.hidden) throw new Error("无法确认 Rootline 工具条已经隐藏，请重试。")
      const image = typeof current.windowId === "number"
        ? await chrome.tabs.captureVisibleTab(current.windowId, { format: "png" })
        : await chrome.tabs.captureVisibleTab({ format: "png" })
      current.screenshot = {
        dataUrl: image,
        capturedAt: new Date().toISOString(),
      }
      // The page UI is hidden only while taking the screenshot. Show a separate
      // progress state while the potentially slower local/COS write finishes.
      await sendToTab(current.tabId, {
        type: "ROOTLINE_SHOW_FINISH_PROGRESS",
        saveMode: current.saveMode ?? "local",
      })
      const written = await writeSessionOffscreen({ ...current, status: "reviewing" })
      if (written.localLocation) current.localArtifacts = written.localLocation
      if (written.remoteLocation) current.remoteArtifacts = written.remoteLocation
      current.boundaries = written.report.boundaries
      // The full screenshot has already been written to Downloads/COS and the
      // history database. Keeping its base64 payload in chrome.storage.session
      // can exceed Chrome's session quota after an otherwise successful upload.
      current.screenshot = {
        ...(current.screenshot.capturedAt ? { capturedAt: current.screenshot.capturedAt } : {}),
        fileName: "capture.png",
        width: current.page.viewport.width,
        height: current.page.viewport.height,
      }
      await sendToTab(current.tabId, { type: "ROOTLINE_COMMIT_FINISH" })
      recordingResultToClear = current.recording?.resultId ?? null
    } catch (error) {
      await sendToTab(current.tabId, { type: "ROOTLINE_ABORT_FINISH" })
      // A retry captures a fresh screenshot. Do not let a large failed-attempt
      // payload hide the real upload error behind a storage quota error.
      current.screenshot = {}
      current.boundaries.push({
        code: "capture-save-failed",
        message: `本次证据未能保存：${error instanceof Error ? error.message : "浏览器未授权截图"}`,
      })
      finishError = error instanceof Error ? error : new Error("浏览器未授权截图")
      return
    }
    current.status = "reviewing"
  })
  if (!session) throw new Error("采集会话不存在或已经过期。")
  if (finishError) throw finishError
  if (recordingResultToClear) await clearStoredRecordingResult(recordingResultToClear).catch(() => undefined)
  await sendToTab(session.tabId, { type: "ROOTLINE_SHOW_COMPLETE", session })
  return session
}

async function exportSession(sessionId: string): Promise<string> {
  const session = await readSession(sessionId)
  if (!session) throw new Error("采集会话不存在或已经过期。")
  const directory = recordNameForSession(session)
  if (!directory) throw new Error("本次采集没有可重新导出的记录。")
  await ensureRootlineOffscreenDocument()
  const response = session.remoteArtifacts
    ? (await chrome.runtime.sendMessage({
        type: "OFFSCREEN_REEXPORT_REMOTE_RECORD",
        directoryName: directory,
      } satisfies OffscreenReexportRemoteRequest)) as ExtensionResponse
    : (await chrome.runtime.sendMessage({
        type: "OFFSCREEN_REEXPORT_RECORD",
        directoryName: directory,
      } satisfies OffscreenReexportRequest)) as ExtensionResponse
  if (!response?.ok) throw new Error(response?.error ?? "报告重新导出失败。")
  await mutateSession(sessionId, (current) => {
    current.status = "exported"
  })
  return directory
}

async function discardSession(sessionId: string): Promise<void> {
  const session = await readSession(sessionId)
  if (!session) return
  await discardSessionRecording(session)
  if (session.status === "capturing") await sendToTab(session.tabId, { type: "ROOTLINE_CLEANUP" })
  await removeSession(sessionId)
}

async function activeState(tabId?: number): Promise<ActiveState> {
  const [tab, recording, saveConfig] = await Promise.all([
    typeof tabId === "number" ? chrome.tabs.get(tabId).catch(() => null) : activeTab(),
    readActiveRecording(),
    readCaptureSaveConfig(),
  ])
  const session = typeof tab?.id === "number" ? await readSessionForTab(tab.id) : null
  return {
    tab: tab ? { ...(typeof tab.id === "number" ? { id: tab.id } : {}), ...(tab.title ? { title: tab.title } : {}), ...(tab.url ? { url: tab.url } : {}) } : null,
    supported: supportedUrl(tab?.url),
    ...(!supportedUrl(tab?.url) ? { unsupportedReason: UNSUPPORTED_PAGE_MESSAGE } : {}),
    session: session ? summarizeSession(session) : null,
    recording,
    saveConfig,
  }
}

function recordNameForSession(session: RootlineSession): string | null {
  if (session.localArtifacts?.directoryName) return session.localArtifacts.directoryName
  if (session.remoteArtifacts?.objectPrefix) return session.remoteArtifacts.objectPrefix.split("/").filter(Boolean).at(-1) ?? null
  return null
}

async function handleMessage(message: ExtensionRequest, sender: chrome.runtime.MessageSender): Promise<ExtensionResponse<unknown>> {
  if (message.type === "GET_ACTIVE_STATE") return { ok: true, data: await activeState(message.tabId) }
  if (message.type === "GET_SAVE_CONFIG") return { ok: true, data: await readCaptureSaveConfig() }
  if (message.type === "SET_SAVE_MODE") return { ok: true, data: await setCaptureSaveMode(message.mode) }
  if (message.type === "CLEAR_COS_CONFIG") return { ok: true, data: await clearTencentCosConfig() }
  if (message.type === "SAVE_COS_CONFIG") {
    return { ok: true, data: await saveTencentCosConfig(normalizeTencentCosConfig(message.config)) }
  }
  if (message.type === "TEST_COS_CONFIG") {
    const config = normalizeTencentCosConfig(message.config)
    await ensureRootlineOffscreenDocument()
    const response = (await chrome.runtime.sendMessage({
      type: "OFFSCREEN_TEST_COS",
      config,
    } satisfies OffscreenTestCosRequest)) as ExtensionResponse
    if (!response?.ok) throw new Error(response?.error ?? "腾讯云 COS 连接测试失败。")
    // The test uses the values currently entered in the settings form. Save
    // those verified values so the next capture cannot use stale credentials.
    const verified = normalizeTencentCosConfig((response.data as TencentCosConfig | undefined) ?? config)
    const saved = await saveTencentCosConfig(verified)
    return { ok: true, data: saved.remote ?? verified }
  }
  if (message.type === "GET_SESSION") {
    const session = await readSession(message.sessionId)
    return session ? { ok: true, data: session } : { ok: false, error: "采集会话不存在或已经过期。" }
  }
  if (message.type === "START_SESSION") return { ok: true, data: await startSession(message.tabId, message.captureMode, message.maxDurationMs) }
  if (message.type === "STOP_RECORDING") {
    const sourceSession = await readSession(message.sessionId)
    if (sender.tab?.id !== undefined && sender.tab.id !== sourceSession?.tabId) {
      return { ok: false, error: "页面会话校验失败。" }
    }
    const session = await stopSessionRecording(message.sessionId)
    await chrome.tabs.update(session.tabId, { active: true }).catch(() => undefined)
    if (typeof session.windowId === "number") await chrome.windows.update(session.windowId, { focused: true }).catch(() => undefined)
    return { ok: true, data: session }
  }
  if (message.type === "REANNOTATE_SESSION") {
    const senderTabId = supportedUrl(sender.tab?.url) ? sender.tab?.id : undefined
    return { ok: true, data: await reannotateSession(message.sessionId, senderTabId) }
  }
  if (message.type === "FINISH_SESSION") return { ok: true, data: await finishSession(message.sessionId) }
  if (message.type === "FINISH_FROM_PAGE") {
    const session = await readSession(message.sessionId)
    if (!session || sender.tab?.id !== session.tabId) return { ok: false, error: "页面会话校验失败。" }
    return { ok: true, data: await finishSession(message.sessionId) }
  }
  if (
    message.type === "GET_AI_CONTEXT_FROM_PAGE"
    || message.type === "EXPORT_FROM_PAGE"
    || message.type === "OPEN_REVIEW_FROM_PAGE"
    || message.type === "OPEN_REMOTE_REPORT_FROM_PAGE"
  ) {
    const session = await readSession(message.sessionId)
    if (!session || sender.tab?.id !== session.tabId || !["reviewing", "exported"].includes(session.status)) {
      return { ok: false, error: "页面会话校验失败。" }
    }
    if (message.type === "GET_AI_CONTEXT_FROM_PAGE") {
      return { ok: true, data: session.remoteArtifacts ? buildRemoteAiContext(session.remoteArtifacts) : buildReportMarkdown(createReport(session)) }
    }
    if (message.type === "OPEN_REMOTE_REPORT_FROM_PAGE") {
      if (!session.remoteArtifacts?.reportUrl) return { ok: false, error: "本次采集没有远程报告链接。" }
      await chrome.tabs.create({ url: session.remoteArtifacts.reportUrl })
      return { ok: true }
    }
    if (message.type === "EXPORT_FROM_PAGE") {
      return { ok: true, data: { directory: await exportSession(session.id) } }
    }
    if (message.type === "OPEN_REVIEW_FROM_PAGE" && session.remoteArtifacts?.reportUrl) {
      await chrome.tabs.create({ url: session.remoteArtifacts.reportUrl })
      return { ok: true }
    }
    const recordName = recordNameForSession(session)
    const reviewUrl = recordName
      ? `capture.html?record=${encodeURIComponent(recordName)}`
      : `capture.html?session=${encodeURIComponent(session.id)}`
    await chrome.tabs.create({ url: chrome.runtime.getURL(reviewUrl) })
    return { ok: true }
  }
  if (message.type === "OPEN_HISTORY_FROM_PAGE") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("capture-history.html") })
    return { ok: true }
  }
  if (message.type === "DISCARD_SESSION") {
    await discardSession(message.sessionId)
    return { ok: true }
  }
  if (message.type === "UPDATE_ISSUE") {
    const session = await mutateSession(message.sessionId, (current) => {
      current.issue = {
        description: truncateText(redactText(message.issue.description), 2_000).value,
        expectedResult: truncateText(redactText(message.issue.expectedResult), 2_000).value,
        notes: truncateText(redactText(message.issue.notes), 4_000).value,
      }
    })
    if (!session) return { ok: false, error: "采集会话不存在或已经过期。" }
    return { ok: true, data: session }
  }
  if (message.type === "MARK_EXPORTED") {
    const session = await mutateSession(message.sessionId, (current) => {
      current.status = "exported"
    })
    if (!session) return { ok: false, error: "采集会话不存在或已经过期。" }
    return { ok: true }
  }
  if (message.type === "RUNTIME_HEARTBEAT") {
    const session = await readSession(message.sessionId)
    return session && sender.tab?.id === session.tabId && session.status === "capturing"
      ? { ok: true }
      : { ok: false, error: "页面会话已经结束。" }
  }

  const session = await mutateSession(message.sessionId, (current) => {
    if (sender.tab?.id !== current.tabId || current.status !== "capturing") {
      throw new Error("页面会话校验失败。")
    }
    if (message.type === "RUNTIME_READY") current.page = message.page
    if (message.type === "RUNTIME_EVENTS") {
      mergeConsole(current, message.console)
      mergeNetwork(current, message.network)
    }
    if (message.type === "TARGET_SELECTED") {
      const target = sanitizeTargetEvidence(message.target)
      const index = current.targets.findIndex((item) => item.id === target.id)
      if (index >= 0) current.targets[index] = target
      else if (current.targets.length >= MAX_TARGETS) current.limits.targetLimitReached = true
      else current.targets.push(target)
      void markRecordingFrame(current.id, `标注元素 ${current.targets.findIndex((item) => item.id === target.id) + 1}`)
    }
    if (message.type === "TARGET_REMOVED") {
      current.targets = current.targets.filter((item) => item.id !== message.targetId)
    }
  })
  if (!session) {
    return { ok: false, error: "页面会话校验失败。" }
  }
  return { ok: true, data: summarizeSession(session) }
}

export default defineBackground(() => {
  void cleanExpiredSessions()
  void reconcileActiveRecording()
  chrome.runtime.onStartup.addListener(() => {
    void cleanExpiredSessions()
    void reconcileActiveRecording()
  })
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isOffscreenRecordingEndedMessage(message)) {
      handleOffscreenRecordingEnded(message)
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "录屏停止状态同步失败。" }))
      return true
    }
    const type = (message as { type?: string }).type
    if (type === "OFFSCREEN_WRITE_SESSION" || type === "OFFSCREEN_WRITE_REMOTE_SESSION" || type === "OFFSCREEN_REEXPORT_RECORD" || type === "OFFSCREEN_REEXPORT_REMOTE_RECORD" || type === "OFFSCREEN_TEST_COS") return false
    if (type === "OFFSCREEN_REMOTE_SAVE_PROGRESS") {
      const request = message as OffscreenRemoteSaveProgressMessage
      if (sender.id !== chrome.runtime.id || typeof request.sessionId !== "string") {
        sendResponse({ ok: false, error: "远程保存进度消息来源校验失败。" })
        return false
      }
      readSession(request.sessionId)
        .then(async (session) => {
          if (!session || session.status !== "capturing") return sendResponse({ ok: false, error: "采集会话已经结束。" })
          await sendToTab(session.tabId, { type: "ROOTLINE_UPDATE_FINISH_PROGRESS", progress: request.progress })
          sendResponse({ ok: true })
        })
        .catch(() => sendResponse({ ok: false, error: "远程保存进度同步失败。" }))
      return true
    }
    if (type === "OFFSCREEN_DOWNLOAD_ARTIFACT") {
      const request = message as OffscreenDownloadRequest
      if (sender.id !== chrome.runtime.id || (!request.url.startsWith("blob:") && !request.url.startsWith("data:"))) {
        sendResponse({ ok: false, error: "下载消息来源校验失败。" })
        return false
      }
      downloadArtifact(request.filename, request.url)
        .then((result) => sendResponse({ ok: true, data: result }))
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "文件保存失败。" }))
      return true
    }
    if (type === "OFFSCREEN_CLEANUP_DOWNLOADS") {
      const downloadIds = (message as { downloadIds?: unknown }).downloadIds
      if (sender.id !== chrome.runtime.id || !Array.isArray(downloadIds) || downloadIds.some((id) => !Number.isInteger(id))) {
        sendResponse({ ok: false, error: "下载清理消息校验失败。" })
        return false
      }
      cleanupDownloads(downloadIds as number[])
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "不完整下载清理失败。" }))
      return true
    }
    handleMessage(message as ExtensionRequest, sender)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Rootline 操作失败。" }))
    return true
  })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECORDING_MAX_DURATION_ALARM) void stopRecordingAtLimit()
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    void readSessionForTab(tabId).then(async (session) => {
      if (!session) return
      await discardSessionRecording(session)
      await removeSession(session.id)
    })
  })
})
