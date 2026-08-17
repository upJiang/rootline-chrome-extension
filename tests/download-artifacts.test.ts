import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeDownloadFilename, waitForDownload } from "../src/lib/download-artifacts"

let searchMock: ReturnType<typeof vi.fn<(query: chrome.downloads.DownloadQuery) => Promise<chrome.downloads.DownloadItem[]>>>

describe("download artifacts", () => {
  beforeEach(() => {
    searchMock = vi.fn<(query: chrome.downloads.DownloadQuery) => Promise<chrome.downloads.DownloadItem[]>>()
    vi.stubGlobal("chrome", { downloads: { search: searchMock } })
  })

  it("normalizes a relative artifact filename", () => {
    expect(normalizeDownloadFilename("Rootline\\capture-1\\report.md")).toBe("Rootline/capture-1/report.md")
    expect(() => normalizeDownloadFilename("../capture/report.md")).toThrow()
    expect(() => normalizeDownloadFilename("C:\\capture\\report.md")).toThrow()
  })

  it("waits until Chrome marks the file complete", async () => {
    searchMock
      .mockResolvedValueOnce([{ id: 7, state: "in_progress" } as chrome.downloads.DownloadItem])
      .mockResolvedValueOnce([{ id: 7, state: "complete", filename: "/tmp/Rootline/report.md" } as chrome.downloads.DownloadItem])
    await expect(waitForDownload(7, 1_000)).resolves.toMatchObject({ state: "complete" })
  })

  it("reports interrupted downloads", async () => {
    searchMock.mockResolvedValueOnce([{
      id: 8,
      state: "interrupted",
      error: "FILE_NO_SPACE",
    } as chrome.downloads.DownloadItem])
    await expect(waitForDownload(8, 1_000)).rejects.toThrow("FILE_NO_SPACE")
  })
})
