import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import {
  listStoredCaptureRecords,
  readStoredCaptureRecord,
  removeStoredCaptureRecord,
  saveStoredCaptureRecord,
} from "../src/lib/capture-history-store"
import { createReport } from "../src/lib/report"
import { makeSession } from "./helpers"

const DIRECTORY_NAME = "rootline-capture-history-test"

afterEach(async () => {
  await removeStoredCaptureRecord(DIRECTORY_NAME).catch(() => undefined)
})

describe("capture history index", () => {
  it("persists the structured report and annotated screenshot independently of a directory handle", async () => {
    const report = createReport({
      ...makeSession(),
      screenshot: {
        dataUrl: "data:image/png;base64,raw",
        markedDataUrl: "data:image/png;base64,marked",
        fileName: "capture.png",
      },
      localArtifacts: {
        rootName: "Chrome 下载目录",
        directoryName: DIRECTORY_NAME,
        downloadRelativeDirectory: `Rootline/${DIRECTORY_NAME}`,
        directoryPath: "/Users/mac/Downloads/Rootline/rootline-capture-history-test",
        reportMarkdownPath: "/Users/mac/Downloads/Rootline/rootline-capture-history-test/report.md",
        reportJsonPath: "/Users/mac/Downloads/Rootline/rootline-capture-history-test/report.json",
        capturePath: "/Users/mac/Downloads/Rootline/rootline-capture-history-test/capture.png",
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

    const stored = await readStoredCaptureRecord(DIRECTORY_NAME)
    expect(stored?.report.localArtifacts?.downloadIds?.capture).toBe(3)
    expect(stored?.report.screenshot.dataUrl).toBeUndefined()
    expect(stored?.report.screenshot.markedDataUrl).toBeUndefined()
    expect(stored?.captureDataUrl).toBe("data:image/png;base64,AA==")
    expect((await listStoredCaptureRecords()).some((record) => record.directoryName === DIRECTORY_NAME)).toBe(true)
  })
})
