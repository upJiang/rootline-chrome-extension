import { beforeEach, describe, expect, it, vi } from "vitest"
import { downloadArtifacts, type ExportArtifacts } from "../src/lib/export"
import { createReport } from "../src/lib/report"
import { makeSession } from "./helpers"

const download = vi.fn(async (_options: chrome.downloads.DownloadOptions) => 1)

beforeEach(() => {
  download.mockClear()
  vi.stubGlobal("chrome", { downloads: { download } })
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:rootline-report"),
    revokeObjectURL: vi.fn(),
  })
  vi.stubGlobal("window", { setTimeout: vi.fn() })
})

describe("offline export", () => {
  it("downloads Markdown, JSON and PNG inside one capture directory", async () => {
    const artifacts: ExportArtifacts = {
      directory: "rootline-capture-2026-08-13T04-00-00-000Z",
      markdown: "# Rootline Runtime Capture",
      json: "{}",
      captureDataUrl: "data:image/png;base64,capture",
      report: createReport(makeSession()),
    }

    await downloadArtifacts(artifacts)

    expect(download.mock.calls.map(([options]) => options)).toEqual([
      {
        filename: "rootline-capture-2026-08-13T04-00-00-000Z/report.md",
        url: "blob:rootline-report",
        conflictAction: "uniquify",
        saveAs: false,
      },
      {
        filename: "rootline-capture-2026-08-13T04-00-00-000Z/report.json",
        url: "blob:rootline-report",
        conflictAction: "uniquify",
        saveAs: false,
      },
      {
        filename: "rootline-capture-2026-08-13T04-00-00-000Z/capture.png",
        url: "data:image/png;base64,capture",
        conflictAction: "uniquify",
        saveAs: false,
      },
    ])
  })
})
