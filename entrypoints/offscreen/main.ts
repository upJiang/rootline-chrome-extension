import type { ExtensionResponse, OffscreenReexportRequest, OffscreenWriteRequest } from "../../src/lib/messaging"
import { reexportCaptureRecord, writeSessionArtifacts } from "../../src/lib/local-artifacts"
import { isRecordingControlMessage } from "../../src/lib/recording-messages"
import { handleOffscreenRecordingMessage } from "../../src/lib/recording-offscreen"

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isRecordingControlMessage(message)) {
    handleOffscreenRecordingMessage(message)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "后台录屏失败。" }))
    return true
  }
  const type = (message as { type?: string })?.type
  if (type !== "OFFSCREEN_WRITE_SESSION" && type !== "OFFSCREEN_REEXPORT_RECORD") return false
  const operation = type === "OFFSCREEN_WRITE_SESSION"
    ? writeSessionArtifacts((message as OffscreenWriteRequest).session)
    : reexportCaptureRecord((message as OffscreenReexportRequest).directoryName)
  operation
    .then((result) => sendResponse({ ok: true, data: result } satisfies ExtensionResponse<typeof result>))
    .catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "本地采集文件写入失败。",
    } satisfies ExtensionResponse))
  return true
})
