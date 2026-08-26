import { beforeEach, describe, expect, it, vi } from "vitest"
import { downloadArtifactUrl, normalizeDownloadFilename, waitForDownload } from "../src/lib/download-artifacts"

let searchMock: ReturnType<typeof vi.fn<(query: chrome.downloads.DownloadQuery) => Promise<chrome.downloads.DownloadItem[]>>>
let downloadMock: ReturnType<typeof vi.fn<(options: chrome.downloads.DownloadOptions) => Promise<number>>>

describe("download artifacts", () => {
  beforeEach(() => {
    searchMock = vi.fn<(query: chrome.downloads.DownloadQuery) => Promise<chrome.downloads.DownloadItem[]>>()
    downloadMock = vi.fn<(options: chrome.downloads.DownloadOptions) => Promise<number>>()
    vi.stubGlobal("chrome", { downloads: { download: downloadMock, search: searchMock } })
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

  it("downloads a remote report into the Rootline record directory", async () => {
    downloadMock.mockResolvedValue(12)
    searchMock.mockResolvedValueOnce([{
      id: 12,
      state: "complete",
      filename: "/Users/test/Downloads/Rootline/capture-1/report.html",
    } as chrome.downloads.DownloadItem])

    await expect(downloadArtifactUrl(
      "Rootline/capture-1/report.html",
      "https://example.com/report.html",
    )).resolves.toMatchObject({ id: 12, filename: "/Users/test/Downloads/Rootline/capture-1/report.html" })
    expect(downloadMock).toHaveBeenCalledWith(expect.objectContaining({
      filename: "Rootline/capture-1/report.html",
      url: "https://example.com/report.html",
    }))
  })

  it("rejects remote report URLs outside HTTP and HTTPS", async () => {
    await expect(downloadArtifactUrl("Rootline/capture-1/report.html", "file:///tmp/report.html"))
      .rejects.toThrow("必须使用 HTTP 或 HTTPS")
    expect(downloadMock).not.toHaveBeenCalled()
  })
})
