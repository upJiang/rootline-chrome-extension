import { readStoredCaptureRecord, saveStoredCaptureRecord } from "./capture-history-store"
import { renderAnnotatedCapture } from "./export"
import type { OffscreenRemoteSaveProgressMessage, RemoteSaveProgress } from "./messaging"
import { readCaptureSaveConfig } from "./remote-config"
import { buildRemoteReportHtml } from "./remote-report"
import { createReport } from "./report"
import { readRecordingResult } from "./recording-result-store"
import { buildCosObjectUrl, deleteCosObject, joinCosKey, putCosObject } from "./tencent-cos"
import { buildCaptureDirectoryName } from "./time"
import { withoutScreenshotPayload } from "./screenshot-payload"
import type {
  RemoteArtifactLocation,
  RootlineIssue,
  RootlineReportV1,
  RootlineSession,
  TencentCosConfig,
} from "./types"

function captureDirectoryName(session: Pick<RootlineSession, "id" | "startedAt">): string {
  return buildCaptureDirectoryName(session.startedAt, session.id.slice(0, 8))
}

async function remoteStage<T>(label: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    throw new Error(`${label}失败：${message}`, { cause: error })
  }
}

function notifyRemoteProgress(sessionId: string, progress: RemoteSaveProgress): void {
  void chrome.runtime.sendMessage({
    type: "OFFSCREEN_REMOTE_SAVE_PROGRESS",
    sessionId,
    progress,
  } satisfies OffscreenRemoteSaveProgressMessage).catch(() => undefined)
}

function remoteLocation(
  session: RootlineSession,
  config: TencentCosConfig,
): RemoteArtifactLocation {
  const directoryName = captureDirectoryName(session)
  const objectPrefix = joinCosKey(config.objectPrefix, directoryName)
  const reportKey = joinCosKey(objectPrefix, "report.html")
  const recordingKey = session.recording ? joinCosKey(objectPrefix, "capture.webm") : undefined
  return {
    provider: "tencent-cos",
    objectPrefix,
    reportKey,
    reportUrl: buildCosObjectUrl(config, reportKey),
    ...(recordingKey ? { recordingKey, recordingUrl: buildCosObjectUrl(config, recordingKey) } : {}),
    uploadedAt: new Date().toISOString(),
  }
}

async function saveRemoteHistory(report: RootlineReportV1, captureDataUrl: string): Promise<void> {
  const directoryName = captureDirectoryName(report)
  const existing = await readStoredCaptureRecord(directoryName)
  await saveStoredCaptureRecord({
    directoryName,
    report,
    captureDataUrl,
    createdAt: existing?.createdAt ?? report.generatedAt,
    updatedAt: new Date().toISOString(),
  })
}

export async function writeRemoteSessionArtifacts(
  session: RootlineSession,
  config: TencentCosConfig,
): Promise<{ report: RootlineReportV1; location: RemoteArtifactLocation }> {
  notifyRemoteProgress(session.id, { stage: "rendering-capture" })
  const captureDataUrl = await remoteStage("生成远程标注截图", () => renderAnnotatedCapture(session, {
    mimeType: "image/webp",
    quality: 0.82,
  }))
  if (!captureDataUrl) throw new Error("没有可上传的页面截图。")
  const recordingResult = session.recording
    ? await remoteStage("读取录屏临时文件", () => readRecordingResult(session.recording!.resultId))
    : null
  if (session.recording && !recordingResult) throw new Error("录屏临时结果已经丢失，无法上传 capture.webm。")

  const location = remoteLocation(session, config)
  const report = createReport({
    ...session,
    saveMode: "remote",
    remoteArtifacts: location,
    screenshot: {
      ...session.screenshot,
      markedDataUrl: captureDataUrl,
      fileName: captureDataUrl.startsWith("data:image/webp") ? "capture.webp" : "capture.png",
      width: session.page.viewport.width,
      height: session.page.viewport.height,
    },
  })
  const uploadedKeys: string[] = []
  try {
    if (recordingResult && location.recordingKey) {
      notifyRemoteProgress(session.id, {
        stage: "uploading-recording",
        loadedBytes: 0,
        totalBytes: recordingResult.blob.size,
        percent: 0,
      })
      await remoteStage("上传录屏", () => putCosObject(
        config,
        location.recordingKey!,
        recordingResult.blob,
        recordingResult.mimeType || "video/webm",
        { contentDisposition: 'inline; filename="capture.webm"', onProgress: (progress) => notifyRemoteProgress(session.id, { stage: "uploading-recording", loadedBytes: progress.loaded, totalBytes: progress.total, percent: progress.percent }) },
      ))
      uploadedKeys.push(location.recordingKey)
    }
    const reportBlob = new Blob([buildRemoteReportHtml(report, captureDataUrl)], { type: "text/html;charset=utf-8" })
    notifyRemoteProgress(session.id, {
      stage: "uploading-report",
      loadedBytes: 0,
      totalBytes: reportBlob.size,
      percent: 0,
    })
    await remoteStage("上传远程报告", () => putCosObject(
      config,
      location.reportKey,
      reportBlob,
      "text/html;charset=utf-8",
      { contentDisposition: 'inline; filename="rootline-report.html"', onProgress: (progress) => notifyRemoteProgress(session.id, { stage: "uploading-report", loadedBytes: progress.loaded, totalBytes: progress.total, percent: progress.percent }) },
    ))
    uploadedKeys.push(location.reportKey)
    let storedReport = withoutScreenshotPayload(report)
    notifyRemoteProgress(session.id, { stage: "saving-history" })
    try {
      await saveRemoteHistory(storedReport, captureDataUrl)
    } catch {
      // The public COS report is the primary artifact. A browser-side history
      // quota failure must not turn a successful remote upload into a retry.
      storedReport = {
        ...storedReport,
        boundaries: [
          ...storedReport.boundaries,
          { code: "remote-history-unavailable", message: "远程报告已上传，但当前浏览器未能保存这条本地历史索引。" },
        ],
      }
    }
    return { report: storedReport, location }
  } catch (error) {
    await Promise.all(uploadedKeys.map((key) => deleteCosObject(config, key).catch(() => undefined)))
    throw error
  }
}

async function rewriteRemoteRecord(directoryName: string, issue?: RootlineIssue): Promise<RootlineReportV1> {
  const [stored, saveConfig] = await Promise.all([
    readStoredCaptureRecord(directoryName),
    readCaptureSaveConfig(),
  ])
  if (!stored?.report.remoteArtifacts || !stored.captureDataUrl) throw new Error("远程采集记录不存在或截图缓存已经被清理。")
  if (!saveConfig.remote) throw new Error("请先重新配置腾讯云 COS。")
  const expectedReportUrl = buildCosObjectUrl(saveConfig.remote, stored.report.remoteArtifacts.reportKey)
  if (expectedReportUrl !== stored.report.remoteArtifacts.reportUrl) {
    throw new Error("当前腾讯云 COS 配置与这条历史记录不一致。请切换回原 Bucket、Region 和访问域名后重试。")
  }

  const generated = createReport({
    ...stored.report,
    ...(issue ? { issue } : {}),
    status: issue ? stored.report.status : "exported",
    saveMode: "remote",
    remoteArtifacts: { ...stored.report.remoteArtifacts, uploadedAt: new Date().toISOString() },
  })
  const report = issue ? { ...generated, generatedAt: stored.report.generatedAt } : generated
  await putCosObject(
    saveConfig.remote,
    report.remoteArtifacts!.reportKey,
    new Blob([buildRemoteReportHtml(report, stored.captureDataUrl)], { type: "text/html;charset=utf-8" }),
    "text/html;charset=utf-8",
    { contentDisposition: 'inline; filename="rootline-report.html"' },
  )
  await saveStoredCaptureRecord({ ...stored, report, updatedAt: new Date().toISOString() })
  return report
}

export async function reexportRemoteCaptureRecord(directoryName: string): Promise<RootlineReportV1> {
  return rewriteRemoteRecord(directoryName)
}

export async function updateRemoteCaptureRecordIssue(
  directoryName: string,
  issue: RootlineIssue,
): Promise<RootlineReportV1> {
  return rewriteRemoteRecord(directoryName, issue)
}
