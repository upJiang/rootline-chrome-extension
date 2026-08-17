import {
  deleteRecordingResult,
  saveRecordingResult,
  type StoredRecordingFrame,
} from "./recording-result-store"
import type { OffscreenRecordingResult, RecordingControlMessage } from "./recording-messages"
import type { RecordingEvidence } from "./types"

const FRAME_WIDTH = 1280
const FRAME_HEIGHT = 720
const RECORDING_FPS = 16
const RECORDING_FRAME_INTERVAL_MS = Math.round(1_000 / RECORDING_FPS)
const RECORDING_VIDEO_BITS_PER_SECOND = 2_800_000
const MAX_RECORDING_FRAMES = 24
const FRAME_SAMPLE_INTERVAL_MS = 1_000
const FRAME_MIN_CAPTURE_INTERVAL_MS = 1_500
const FRAME_DIFF_THRESHOLD = 0.16
const FINAL_RECORDING_TAIL_MS = 800
const FINAL_RECORDING_FRAME_INTERVAL_MS = 100

interface ActiveRecording {
  canvas: HTMLCanvasElement
  canvasStream: MediaStream
  context: CanvasRenderingContext2D
  frameQueue: StoredRecordingFrame[]
  lastFrameCaptureAt: number
  lastFrameSampleAt: number
  lastSignature: Uint8ClampedArray | null
  mediaRecorder: MediaRecorder
  recordedChunks: Blob[]
  resultId: string
  sessionId: string
  startedAt: number
  stream: MediaStream
  timerId: number
  video: HTMLVideoElement
}

let active: ActiveRecording | null = null
let stopping: Promise<OffscreenRecordingResult> | null = null

export async function handleOffscreenRecordingMessage(message: RecordingControlMessage): Promise<OffscreenRecordingResult | { active: boolean; resultId?: string; startedAt?: number }> {
  if (message.type === "ROOTLINE_OFFSCREEN_START_RECORDING") {
    const started = await startRecording(message.sessionId, message.maxDurationMs)
    return { active: true, resultId: started.resultId, startedAt: started.startedAt }
  }
  if (message.type === "ROOTLINE_OFFSCREEN_STOP_RECORDING") {
    return stopRecording(message.sessionId, Boolean(message.discard), message.reason)
  }
  if (message.type === "ROOTLINE_OFFSCREEN_MARK_FRAME") {
    if (active?.sessionId === message.sessionId) markFrame(active, message.label)
    return { active: active?.sessionId === message.sessionId }
  }
  return { active: active?.sessionId === message.sessionId }
}

async function startRecording(sessionId: string, _maxDurationMs: number): Promise<{ resultId: string; startedAt: number }> {
  if (active) throw new Error("已有 Rootline 录屏正在进行，请先停止当前录制。")
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("当前浏览器不支持整屏录制。")

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    monitorTypeSurfaces: "include",
    video: { displaySurface: "monitor" },
  } as DisplayMediaStreamOptions)
  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) {
    stopTracks(stream)
    throw new Error("没有获得可用的屏幕视频流。")
  }

  const video = document.createElement("video")
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;"
  video.srcObject = stream
  document.body.append(video)

  try {
    await waitForLoadedMetadata(video)
    await video.play()
    await waitForVideoFrame(video)

    const canvas = document.createElement("canvas")
    canvas.width = FRAME_WIDTH
    canvas.height = FRAME_HEIGHT
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法初始化录制画布。")
    context.fillStyle = "#111827"
    context.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
    const canvasStream = canvas.captureStream(RECORDING_FPS)
    const mimeType = selectRecordingMimeType()
    const mediaRecorder = new MediaRecorder(canvasStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
    })
    const startedAt = Date.now()
    const current: ActiveRecording = {
      canvas,
      canvasStream,
      context,
      frameQueue: [],
      lastFrameCaptureAt: 0,
      lastFrameSampleAt: 0,
      lastSignature: null,
      mediaRecorder,
      recordedChunks: [],
      resultId: `recording_${startedAt}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      startedAt,
      stream,
      timerId: 0,
      video,
    }
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) current.recordedChunks.push(event.data)
    })
    active = current
    drawCurrentFrame(current)
    current.timerId = window.setInterval(() => drawCurrentFrame(current), RECORDING_FRAME_INTERVAL_MS)
    mediaRecorder.start(1_000)
    videoTrack.addEventListener("ended", () => {
      if (active?.sessionId !== sessionId) return
      void stopRecording(sessionId, false, "sharing-ended").then((result) => {
        void chrome.runtime.sendMessage({ type: "ROOTLINE_OFFSCREEN_RECORDING_ENDED", sessionId, recording: result.recording })
      }).catch((error: unknown) => {
        void chrome.runtime.sendMessage({ type: "ROOTLINE_OFFSCREEN_RECORDING_ENDED", sessionId, error: error instanceof Error ? error.message : "录屏已停止但结果未能保存。" })
      })
    }, { once: true })
    return { resultId: current.resultId, startedAt: current.startedAt }
  } catch (error) {
    video.srcObject = null
    video.remove()
    stopTracks(stream)
    throw error
  }
}

async function stopRecording(sessionId: string, discard: boolean, _reason?: string): Promise<OffscreenRecordingResult> {
  if (stopping) return stopping
  if (!active || active.sessionId !== sessionId) return { stopped: false }
  const current = active
  stopping = (async () => {
    try {
      if (!discard) await flushFinalRecordingTail(current)
      const blob = await stopMediaRecorder(current)
      const durationMs = Math.max(0, Date.now() - current.startedAt)
      const recording: RecordingEvidence = {
        resultId: current.resultId,
        fileName: "capture.webm",
        mimeType: blob.type || "video/webm",
        startedAt: new Date(current.startedAt).toISOString(),
        durationMs,
        sizeBytes: blob.size,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        frameCount: current.frameQueue.length,
        keyframes: current.frameQueue.map((frame) => ({
          offsetMs: frame.offsetMs,
          reason: frame.reason,
          ...(frame.label ? { label: frame.label } : {}),
        })),
      }
      if (!discard) {
        await saveRecordingResult({
          id: current.resultId,
          blob,
          createdAt: Date.now(),
          durationMs,
          frameQueue: current.frameQueue,
          mimeType: recording.mimeType,
          startedAt: current.startedAt,
        })
      } else {
        await deleteRecordingResult(current.resultId).catch(() => undefined)
      }
      return { stopped: true, ...(discard ? {} : { recording }) }
    } finally {
      cleanup(current)
    }
  })()
  try {
    return await stopping
  } finally {
    stopping = null
  }
}

async function flushFinalRecordingTail(current: ActiveRecording): Promise<void> {
  const deadline = Date.now() + FINAL_RECORDING_TAIL_MS
  while (Date.now() < deadline && active === current) {
    drawCurrentFrame(current)
    await new Promise((resolve) => window.setTimeout(resolve, FINAL_RECORDING_FRAME_INTERVAL_MS))
  }
  if (active === current) {
    drawCurrentFrame(current)
    captureFrame(current, "stop", "录屏结束")
  }
}

function drawCurrentFrame(current: ActiveRecording): void {
  if (active !== current || current.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  const sourceWidth = current.video.videoWidth
  const sourceHeight = current.video.videoHeight
  if (!(sourceWidth && sourceHeight)) return
  const scale = Math.min(FRAME_WIDTH / sourceWidth, FRAME_HEIGHT / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  const x = Math.round((FRAME_WIDTH - width) / 2)
  const y = Math.round((FRAME_HEIGHT - height) / 2)
  current.context.fillStyle = "#111827"
  current.context.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
  current.context.drawImage(current.video, x, y, width, height)
  maybeCaptureSignificantFrame(current)
}

function maybeCaptureSignificantFrame(current: ActiveRecording): void {
  const now = Date.now()
  if (now - current.lastFrameSampleAt < FRAME_SAMPLE_INTERVAL_MS) return
  current.lastFrameSampleAt = now
  const signature = createSignature(current.context)
  if (!signature) return
  const previous = current.lastSignature
  current.lastSignature = signature
  if (!previous || (now - current.lastFrameCaptureAt >= FRAME_MIN_CAPTURE_INTERVAL_MS && signatureDiff(previous, signature) >= FRAME_DIFF_THRESHOLD)) {
    captureFrame(current, previous ? "page-change" : "start")
  }
}

function markFrame(current: ActiveRecording, label: string): void {
  drawCurrentFrame(current)
  captureFrame(current, "marker", label)
}

function captureFrame(current: ActiveRecording, reason: StoredRecordingFrame["reason"], label?: string): void {
  const capturedAt = Date.now()
  try {
    const dataUrl = current.canvas.toDataURL("image/webp", 0.72)
    current.frameQueue = [...current.frameQueue, {
      id: `frame_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`,
      capturedAt,
      offsetMs: Math.max(0, capturedAt - current.startedAt),
      dataUrl,
      reason,
      ...(label ? { label } : {}),
    }].slice(-MAX_RECORDING_FRAMES)
    current.lastFrameCaptureAt = capturedAt
  } catch {
    // A frame failure must not interrupt the video stream.
  }
}

function createSignature(context: CanvasRenderingContext2D): Uint8ClampedArray | null {
  try {
    return context.getImageData(0, 0, 48, 27).data
  } catch {
    return null
  }
}

function signatureDiff(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
  const size = Math.min(left.length, right.length)
  if (!size) return 0
  let total = 0
  for (let index = 0; index < size; index += 4) {
    const leftRed = left[index] ?? 0
    const leftGreen = left[index + 1] ?? 0
    const leftBlue = left[index + 2] ?? 0
    const rightRed = right[index] ?? 0
    const rightGreen = right[index + 1] ?? 0
    const rightBlue = right[index + 2] ?? 0
    total += Math.abs(leftRed - rightRed) + Math.abs(leftGreen - rightGreen) + Math.abs(leftBlue - rightBlue)
  }
  return total / (size / 4) / (255 * 3)
}

export function selectRecordingMimeType(
  isSupported: (candidate: string) => boolean = (candidate) => MediaRecorder.isTypeSupported(candidate),
): string | undefined {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(isSupported)
}

function stopMediaRecorder(current: ActiveRecording): Promise<Blob> {
  return new Promise((resolve) => {
    const mimeType = current.mediaRecorder.mimeType || "video/webm"
    if (current.mediaRecorder.state === "inactive") {
      resolve(new Blob(current.recordedChunks, { type: mimeType }))
      return
    }
    current.mediaRecorder.addEventListener("stop", () => resolve(new Blob(current.recordedChunks, { type: mimeType })), { once: true })
    try { current.mediaRecorder.requestData() } catch { /* no pending data yet */ }
    current.mediaRecorder.stop()
  })
}

function cleanup(current: ActiveRecording): void {
  window.clearInterval(current.timerId)
  stopTracks(current.canvasStream)
  stopTracks(current.stream)
  current.video.srcObject = null
  current.video.remove()
  current.canvas.remove()
  if (active === current) active = null
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("等待屏幕视频元数据超时。")), 4_000)
    video.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve() }, { once: true })
    video.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("无法读取屏幕视频流。")) }, { once: true })
  })
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve()
  return new Promise((resolve) => {
    const callback = () => resolve()
    const requestVideoFrame = video.requestVideoFrameCallback?.bind(video)
    if (requestVideoFrame) {
      requestVideoFrame(callback)
    } else {
      video.addEventListener("loadeddata", callback, { once: true })
      window.setTimeout(callback, 1_000)
    }
  })
}
