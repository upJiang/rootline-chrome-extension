import { z } from "zod"
import {
  listStoredCaptureRecords,
  readStoredCaptureRecord,
  removeStoredCaptureRecord,
  saveStoredCaptureRecord,
  type StoredCaptureRecord,
} from "./capture-history-store"
import {
  requestArtifactDownloadBlob,
  requestDownloadCleanup,
} from "./download-artifacts"
import { renderAnnotatedCapture } from "./export"
import { joinNativePath, parentDirectoryPath } from "./local-paths"
import { buildReportMarkdown, createReport, serializeReportJson } from "./report"
import { readRecordingResult } from "./recording-result-store"
import { buildCaptureDirectoryName } from "./time"
import { withoutScreenshotPayload } from "./screenshot-payload"
import type {
  ArtifactAvailability,
  ArtifactKind,
  LocalArtifactLocation,
  RootlineIssue,
  RootlineReportV1,
  RootlineSession,
  RemoteArtifactLocation,
} from "./types"

const DOWNLOAD_ROOT_DIRECTORY = "Rootline"

const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const stringRecordSchema = z.record(z.string())
const targetSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  rect: rectSchema,
  tagName: z.string(),
  role: z.string().optional(),
  text: z.string().optional(),
  idAttribute: z.string().optional(),
  classNames: z.array(z.string()),
  testId: z.string().optional(),
  aria: stringRecordSchema,
  selector: z.string(),
  xpath: z.string(),
  ancestorPath: z.string(),
  dom: z.string(),
  computedStyle: stringRecordSchema,
  beforeStyle: stringRecordSchema.optional(),
  afterStyle: stringRecordSchema.optional(),
  cssRules: z.array(z.object({ selector: z.string(), cssText: z.string(), styleSheetUrl: z.string().optional() })),
  selectionKind: z.enum(["element", "spacing", "text-line"]).optional(),
  spacing: z.object({
    axis: z.enum(["horizontal", "vertical"]),
    distance: z.number(),
    from: z.string(),
    to: z.string(),
  }).optional(),
  react: z.object({
    componentChain: z.array(z.string()),
    propsKeys: z.array(z.string()),
    available: z.boolean(),
    boundary: z.string().optional(),
  }).optional(),
  annotation: z.object({ actualResult: z.string(), expectedResult: z.string() }).optional(),
})
const consoleSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  message: z.string(),
  stack: z.string().optional(),
  truncated: z.boolean().optional(),
})
const networkSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  method: z.string(),
  url: z.string(),
  type: z.enum(["fetch", "xhr", "resource"]),
  resourceType: z.string().optional(),
  status: z.number().optional(),
  duration: z.number().optional(),
  requestHeaders: stringRecordSchema.optional(),
  responseHeaders: stringRecordSchema.optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  requestBodyTruncated: z.boolean().optional(),
  responseBodyTruncated: z.boolean().optional(),
  error: z.string().optional(),
})
const downloadIdsSchema = z.object({
  markdown: z.number().optional(),
  json: z.number().optional(),
  capture: z.number().optional(),
  recording: z.number().optional(),
}).optional()
const localArtifactsSchema = z.object({
  rootName: z.string(),
  directoryName: z.string(),
  downloadRelativeDirectory: z.string().optional(),
  directoryPath: z.string(),
  reportMarkdownPath: z.string(),
  reportJsonPath: z.string(),
  capturePath: z.string(),
  recordingPath: z.string().optional(),
  downloadIds: downloadIdsSchema,
  savedAt: z.string(),
})
const remoteArtifactsSchema = z.object({
  provider: z.enum(["tencent-cos", "aliyun-oss"]),
  objectPrefix: z.string(),
  reportUrl: z.string().url(),
  recordingUrl: z.string().url().optional(),
  reportKey: z.string(),
  recordingKey: z.string().optional(),
  uploadedAt: z.string(),
})

export const rootlineReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  tabId: z.number(),
  windowId: z.number().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["capturing", "reviewing", "exported", "discarded"]),
  page: z.object({
    url: z.string(),
    title: z.string(),
    origin: z.string(),
    viewport: z.object({ width: z.number(), height: z.number(), devicePixelRatio: z.number() }),
    userAgent: z.string(),
    language: z.string(),
    capturedAt: z.string(),
  }),
  issue: z.object({ description: z.string(), expectedResult: z.string(), notes: z.string() }),
  targets: z.array(targetSchema),
  console: z.array(consoleSchema),
  network: z.array(networkSchema),
  limits: z.object({ consoleDropped: z.number(), networkDropped: z.number(), targetLimitReached: z.boolean() }),
  boundaries: z.array(z.object({ code: z.string(), message: z.string() })),
  screenshot: z.object({
    fileName: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    capturedAt: z.string().optional(),
  }).passthrough(),
  captureMode: z.enum(["screenshot", "video"]).optional(),
  recordingState: z.object({
    resultId: z.string(),
    status: z.enum(["starting", "recording", "stopped", "failed"]),
    startedAt: z.string(),
    maxDurationMs: z.number(),
    stoppedAt: z.string().optional(),
    error: z.string().optional(),
  }).optional(),
  recording: z.object({
    resultId: z.string(),
    fileName: z.literal("capture.webm"),
    mimeType: z.string(),
    startedAt: z.string(),
    durationMs: z.number(),
    sizeBytes: z.number(),
    width: z.literal(1280),
    height: z.literal(720),
    frameCount: z.number(),
    keyframes: z.array(z.object({
      offsetMs: z.number(),
      reason: z.enum(["start", "page-change", "marker", "stop"]),
      label: z.string().optional(),
    })).optional(),
  }).optional(),
  localArtifacts: localArtifactsSchema.optional(),
  saveMode: z.enum(["local", "remote"]).optional(),
  remoteArtifacts: remoteArtifactsSchema.optional(),
  generatedAt: z.string(),
}).passthrough()

export interface CaptureHistoryItem {
  directoryName: string
  state: "ready" | "invalid"
  report?: RootlineReportV1
  location?: LocalArtifactLocation
  remoteLocation?: RemoteArtifactLocation
  hasCapture: boolean
  hasRecording: boolean
  hasMarkdown: boolean
  captureState: ArtifactAvailability
  recordingState: ArtifactAvailability
  markdownState: ArtifactAvailability
  jsonState: ArtifactAvailability
  error?: string
}

export interface CaptureRecord {
  report: RootlineReportV1
  location?: LocalArtifactLocation
  remoteLocation?: RemoteArtifactLocation
  captureFile: File | null
  recordingFile: File | null
  hasMarkdown: boolean
  captureState: ArtifactAvailability
  recordingState: ArtifactAvailability
  markdownState: ArtifactAvailability
  jsonState: ArtifactAvailability
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2)
  if (!header || !encoded || !header.includes(";base64")) throw new Error("标注截图格式无效。")
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? "image/png"
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function dataUrlToFile(dataUrl: string, name: string): File {
  return new File([dataUrlToBlob(dataUrl)], name, { type: "image/png" })
}

function captureDirectoryName(session: Pick<RootlineSession, "id" | "startedAt">): string {
  return buildCaptureDirectoryName(session.startedAt, session.id.slice(0, 8))
}

async function saveHistory(report: RootlineReportV1, captureDataUrl: string): Promise<void> {
  const directoryName = report.localArtifacts?.directoryName
  if (!directoryName) throw new Error("采集报告缺少本地目录信息。")
  const existing = await readStoredCaptureRecord(directoryName)
  await saveStoredCaptureRecord({
    directoryName,
    report,
    captureDataUrl,
    createdAt: existing?.createdAt ?? report.generatedAt,
    updatedAt: new Date().toISOString(),
  })
}

async function writeDownloadedArtifacts(
  session: RootlineSession,
): Promise<{ report: RootlineReportV1; location: LocalArtifactLocation }> {
  const captureDataUrl = await renderAnnotatedCapture(session)
  if (!captureDataUrl) throw new Error("没有可写入的页面截图。")
  const recordingResult = session.recording ? await readRecordingResult(session.recording.resultId) : null
  if (session.recording && !recordingResult) throw new Error("录屏临时结果已经丢失，无法写入 capture.webm。")

  const directoryName = captureDirectoryName(session)
  const relativeDirectory = `${DOWNLOAD_ROOT_DIRECTORY}/${directoryName}`
  const createdIds: number[] = []
  try {
    const capture = await requestArtifactDownloadBlob(`${relativeDirectory}/capture.png`, dataUrlToBlob(captureDataUrl))
    createdIds.push(capture.id)
    const recording = recordingResult
      ? await requestArtifactDownloadBlob(`${relativeDirectory}/capture.webm`, recordingResult.blob)
      : null
    if (recording) createdIds.push(recording.id)

    const directoryPath = parentDirectoryPath(capture.filename)
    let location: LocalArtifactLocation = {
      rootName: "Chrome 下载目录",
      directoryName,
      downloadRelativeDirectory: relativeDirectory,
      directoryPath,
      reportMarkdownPath: joinNativePath(directoryPath, "report.md"),
      reportJsonPath: joinNativePath(directoryPath, "report.json"),
      capturePath: capture.filename,
      ...(recording ? { recordingPath: recording.filename } : {}),
      downloadIds: {
        capture: capture.id,
        ...(recording ? { recording: recording.id } : {}),
      },
      savedAt: new Date().toISOString(),
    }
    let report = createReport({
      ...session,
      localArtifacts: location,
      screenshot: {
        ...session.screenshot,
        markedDataUrl: captureDataUrl,
        fileName: "capture.png",
        width: session.page.viewport.width,
        height: session.page.viewport.height,
      },
    })
    const markdown = await requestArtifactDownloadBlob(
      `${relativeDirectory}/report.md`,
      new Blob([buildReportMarkdown(report)], { type: "text/markdown;charset=utf-8" }),
    )
    createdIds.push(markdown.id)
    location = {
      ...location,
      reportMarkdownPath: markdown.filename,
      downloadIds: { ...location.downloadIds, markdown: markdown.id },
    }
    report = { ...report, localArtifacts: location }
    const json = await requestArtifactDownloadBlob(
      `${relativeDirectory}/report.json`,
      new Blob([serializeReportJson(report)], { type: "application/json;charset=utf-8" }),
    )
    createdIds.push(json.id)
    location = {
      ...location,
      reportJsonPath: json.filename,
      downloadIds: { ...location.downloadIds, json: json.id },
    }
    report = { ...report, localArtifacts: location }
    const storedReport = withoutScreenshotPayload(report)
    await saveHistory(storedReport, captureDataUrl)
    return { report: storedReport, location }
  } catch (error) {
    await requestDownloadCleanup(createdIds).catch(() => undefined)
    await removeStoredCaptureRecord(directoryName).catch(() => undefined)
    throw error
  }
}

export async function writeSessionArtifacts(
  session: RootlineSession,
): Promise<{ report: RootlineReportV1; location: LocalArtifactLocation }> {
  return writeDownloadedArtifacts(session)
}

async function downloadAvailability(downloadId?: number): Promise<ArtifactAvailability> {
  if (typeof downloadId !== "number" || typeof chrome === "undefined" || !chrome.downloads?.search) return "unknown"
  try {
    const [item] = await chrome.downloads.search({ id: downloadId })
    if (!item) return "unknown"
    if (item.state === "interrupted" || item.exists === false) return "missing"
    return item.state === "complete" ? "available" : "unknown"
  } catch {
    return "unknown"
  }
}

async function remoteAvailability(url?: string): Promise<ArtifactAvailability> {
  if (!url || typeof fetch !== "function") return "unknown"
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" })
    return response.ok ? "available" : "missing"
  } catch {
    return "unknown"
  }
}

async function recordFromStored(stored: StoredCaptureRecord): Promise<CaptureRecord> {
  const report = rootlineReportSchema.parse(stored.report) as RootlineReportV1
  const location = report.localArtifacts
  const remoteLocation = report.remoteArtifacts
  if (!location && !remoteLocation) throw new Error("采集记录缺少文件位置信息。")
  const captureFile = stored.captureDataUrl ? dataUrlToFile(stored.captureDataUrl, "capture.png") : null
  if (remoteLocation) {
    const [reportState, recordingState] = await Promise.all([
      remoteAvailability(remoteLocation.reportUrl),
      report.recording ? remoteAvailability(remoteLocation.recordingUrl) : Promise.resolve("missing" as const),
    ])
    return {
      report,
      remoteLocation,
      captureFile,
      recordingFile: null,
      hasMarkdown: reportState !== "missing",
      captureState: captureFile ? "available" : "missing",
      recordingState,
      markdownState: reportState,
      jsonState: "missing",
    }
  }
  if (!location) throw new Error("采集记录缺少本地文件位置。")
  const ids = location.downloadIds
  const [captureState, recordingState, markdownState, jsonState] = await Promise.all([
    downloadAvailability(ids?.capture),
    report.recording ? downloadAvailability(ids?.recording) : Promise.resolve("missing" as const),
    downloadAvailability(ids?.markdown),
    downloadAvailability(ids?.json),
  ])
  return {
    report,
    location,
    captureFile,
    recordingFile: null,
    hasMarkdown: markdownState !== "missing",
    captureState,
    recordingState,
    markdownState,
    jsonState,
  }
}

export async function readCaptureRecord(directoryName: string): Promise<CaptureRecord> {
  const stored = await readStoredCaptureRecord(directoryName)
  if (stored) return recordFromStored(stored)
  throw new Error("采集记录不存在或本地索引已经被清理。")
}

export async function listCaptureHistory(): Promise<CaptureHistoryItem[]> {
  const storedRecords = await listStoredCaptureRecords()
  const entries = await Promise.all(storedRecords.map(async (stored): Promise<CaptureHistoryItem> => {
    try {
      const record = await recordFromStored(stored)
      return {
        directoryName: stored.directoryName,
        state: "ready",
        report: record.report,
        ...(record.location ? { location: record.location } : {}),
        ...(record.remoteLocation ? { remoteLocation: record.remoteLocation } : {}),
        hasCapture: record.captureState !== "missing",
        hasRecording: record.recordingState !== "missing",
        hasMarkdown: record.hasMarkdown,
        captureState: record.captureState,
        recordingState: record.recordingState,
        markdownState: record.markdownState,
        jsonState: record.jsonState,
      }
    } catch (error) {
      return {
        directoryName: stored.directoryName,
        state: "invalid",
        hasCapture: false,
        hasRecording: false,
        hasMarkdown: false,
        captureState: "missing",
        recordingState: "missing",
        markdownState: "missing",
        jsonState: "missing",
        error: error instanceof Error ? error.message : "无法读取采集记录。",
      }
    }
  }))
  return entries.sort((left, right) => {
    const leftTime = left.report?.generatedAt ?? left.directoryName
    const rightTime = right.report?.generatedAt ?? right.directoryName
    return rightTime.localeCompare(leftTime)
  })
}

function fallbackRelativeDirectory(directoryName: string): string {
  return `${DOWNLOAD_ROOT_DIRECTORY}/${directoryName}`
}

async function rewriteDownloadedRecord(record: CaptureRecord, report: RootlineReportV1): Promise<CaptureRecord> {
  if (!record.location) throw new Error("采集记录缺少本地文件位置。")
  const relativeDirectory = record.location.downloadRelativeDirectory ?? fallbackRelativeDirectory(record.location.directoryName)
  const markdown = await requestArtifactDownloadBlob(
    `${relativeDirectory}/report.md`,
    new Blob([buildReportMarkdown(report)], { type: "text/markdown;charset=utf-8" }),
  )
  let location: LocalArtifactLocation = {
    ...record.location,
    downloadRelativeDirectory: relativeDirectory,
    reportMarkdownPath: markdown.filename,
    downloadIds: { ...record.location.downloadIds, markdown: markdown.id },
    savedAt: new Date().toISOString(),
  }
  let nextReport = { ...report, localArtifacts: location }
  const json = await requestArtifactDownloadBlob(
    `${relativeDirectory}/report.json`,
    new Blob([serializeReportJson(nextReport)], { type: "application/json;charset=utf-8" }),
  )
  location = {
    ...location,
    reportJsonPath: json.filename,
    downloadIds: { ...location.downloadIds, json: json.id },
  }
  nextReport = { ...nextReport, localArtifacts: location }
  const stored = await readStoredCaptureRecord(location.directoryName)
  await saveStoredCaptureRecord({
    directoryName: location.directoryName,
    report: nextReport,
    ...(stored?.captureDataUrl ? { captureDataUrl: stored.captureDataUrl } : {}),
    createdAt: stored?.createdAt ?? nextReport.generatedAt,
    updatedAt: new Date().toISOString(),
  })
  return recordFromStored((await readStoredCaptureRecord(location.directoryName))!)
}

async function rewriteRecord(directoryName: string, issue?: RootlineIssue): Promise<CaptureRecord> {
  const record = await readCaptureRecord(directoryName)
  if (!record.location) throw new Error("该记录是远程报告，请在远程保存配置中选择原来的云服务商后重新导出。")
  if (issue && record.report.issue.description === issue.description
    && record.report.issue.expectedResult === issue.expectedResult
    && record.report.issue.notes === issue.notes) {
    return record
  }
  const generated = createReport({
    ...record.report,
    ...(issue ? { issue } : {}),
    status: issue ? record.report.status : "exported",
    localArtifacts: { ...record.location, savedAt: new Date().toISOString() },
  })
  const report = issue ? { ...generated, generatedAt: record.report.generatedAt } : generated
  return rewriteDownloadedRecord(record, report)
}

export async function reexportCaptureRecord(directoryName: string): Promise<CaptureRecord> {
  return rewriteRecord(directoryName)
}

export async function updateCaptureRecordIssue(directoryName: string, issue: RootlineIssue): Promise<CaptureRecord> {
  return rewriteRecord(directoryName, issue)
}

export async function openCaptureRecording(directoryName: string): Promise<ArtifactAvailability> {
  const record = await readCaptureRecord(directoryName)
  if (record.remoteLocation?.recordingUrl) {
    await chrome.tabs.create({ url: record.remoteLocation.recordingUrl })
    return "available"
  }
  if (!record.location) return "missing"
  const downloadId = record.location.downloadIds?.recording
  if (typeof downloadId !== "number") return record.recordingState
  const state = await downloadAvailability(downloadId)
  if (state === "available") await chrome.downloads.open(downloadId)
  return state
}
