import type { ExtensionResponse, OffscreenReexportRemoteRequest, OffscreenReexportRequest, OffscreenTestCosRequest, OffscreenWriteRemoteRequest, OffscreenWriteRequest } from "../../src/lib/messaging"
import { reexportCaptureRecord, writeSessionArtifacts } from "../../src/lib/local-artifacts"
import { isRecordingControlMessage } from "../../src/lib/recording-messages"
import { handleOffscreenRecordingMessage } from "../../src/lib/recording-offscreen"
import { reexportRemoteCaptureRecord, writeRemoteSessionArtifacts } from "../../src/lib/remote-artifacts"
import { testTencentCosConnection } from "../../src/lib/tencent-cos"

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isRecordingControlMessage(message)) {
    handleOffscreenRecordingMessage(message)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "后台录屏失败。" }))
    return true
  }
  const type = (message as { type?: string })?.type
  if (type !== "OFFSCREEN_WRITE_SESSION" && type !== "OFFSCREEN_WRITE_REMOTE_SESSION" && type !== "OFFSCREEN_REEXPORT_RECORD" && type !== "OFFSCREEN_REEXPORT_REMOTE_RECORD" && type !== "OFFSCREEN_TEST_COS") return false
  const operation = type === "OFFSCREEN_WRITE_SESSION"
    ? writeSessionArtifacts((message as OffscreenWriteRequest).session)
    : type === "OFFSCREEN_WRITE_REMOTE_SESSION"
      ? writeRemoteSessionArtifacts((message as OffscreenWriteRemoteRequest).session, (message as OffscreenWriteRemoteRequest).config)
      : type === "OFFSCREEN_TEST_COS"
        ? testTencentCosConnection((message as OffscreenTestCosRequest).config)
        : type === "OFFSCREEN_REEXPORT_REMOTE_RECORD"
          ? reexportRemoteCaptureRecord((message as OffscreenReexportRemoteRequest).directoryName)
          : reexportCaptureRecord((message as OffscreenReexportRequest).directoryName)
  operation
    .then((result) => sendResponse({ ok: true, data: result } satisfies ExtensionResponse<typeof result>))
    .catch((error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "采集文件处理失败。",
    } satisfies ExtensionResponse))
  return true
})
