import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readStoredCaptureRecord, removeStoredCaptureRecord, saveStoredCaptureRecord } from "../src/lib/capture-history-store"
import { rootlineReportSchema, updateCaptureRecordIssue } from "../src/lib/local-artifacts"
import { createReport, serializeReportJson } from "../src/lib/report"
import { makeSession } from "./helpers"

const DIRECTORY_NAME = "rootline-capture-test"
const downloadSearch = vi.fn(async () => [{ state: "complete", exists: true }] as chrome.downloads.DownloadItem[])
const sendMessage = vi.fn()

beforeEach(() => {
  downloadSearch.mockClear()
  sendMessage.mockClear()
  vi.stubGlobal("chrome", {
    downloads: { search: downloadSearch },
    runtime: { sendMessage },
  })
})

afterEach(async () => {
  await removeStoredCaptureRecord(DIRECTORY_NAME).catch(() => undefined)
  vi.unstubAllGlobals()
})

describe("local capture record validation", () => {
  it("accepts legacy v1 reports without local artifact metadata", () => {
    const parsed = JSON.parse(serializeReportJson(createReport(makeSession()))) as unknown
    expect(rootlineReportSchema.safeParse(parsed).success).toBe(true)
  })

  it("rejects malformed reports before history renders them", () => {
    const parsed = JSON.parse(serializeReportJson(createReport(makeSession()))) as Record<string, unknown>
    parsed.targets = [{ id: "unsafe-incomplete-target" }]
    expect(rootlineReportSchema.safeParse(parsed).success).toBe(false)
  })

  it("accepts recording metadata with keyframe markers while keeping screenshot-only reports compatible", () => {
    const report = createReport({
      ...makeSession(),
      captureMode: "video",
      recording: {
        resultId: "recording-1",
        fileName: "capture.webm",
        mimeType: "video/webm;codecs=vp9",
        startedAt: "2026-08-14T01:00:00.000Z",
        durationMs: 12_000,
        sizeBytes: 1_024,
        width: 1280,
        height: 720,
        frameCount: 1,
        keyframes: [{ offsetMs: 800, reason: "marker", label: "标注元素 1" }],
      },
    })
    expect(rootlineReportSchema.safeParse(JSON.parse(serializeReportJson(report))).success).toBe(true)
  })

  it("does not download reports when the issue has not changed", async () => {
    const report = createReport({
      ...makeSession(),
      localArtifacts: {
        rootName: "Chrome 下载目录",
        directoryName: DIRECTORY_NAME,
        downloadRelativeDirectory: `Rootline/${DIRECTORY_NAME}`,
        directoryPath: `/Users/mac/Downloads/Rootline/${DIRECTORY_NAME}`,
        reportMarkdownPath: `/Users/mac/Downloads/Rootline/${DIRECTORY_NAME}/report.md`,
        reportJsonPath: `/Users/mac/Downloads/Rootline/${DIRECTORY_NAME}/report.json`,
        capturePath: `/Users/mac/Downloads/Rootline/${DIRECTORY_NAME}/capture.png`,
        downloadIds: { markdown: 1, json: 2, capture: 3 },
        savedAt: "2026-08-14T10:00:00.000Z",
      },
    })
    await saveStoredCaptureRecord({
      directoryName: DIRECTORY_NAME,
      report,
      captureDataUrl: "data:image/png;base64,AA==",
      createdAt: report.generatedAt,
      updatedAt: report.generatedAt,
    })

    const result = await updateCaptureRecordIssue(DIRECTORY_NAME, report.issue)

    expect(result.report.issue).toEqual(report.issue)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(downloadSearch).toHaveBeenCalledTimes(3)
    expect(await readStoredCaptureRecord(DIRECTORY_NAME)).not.toBeNull()
  })
})
