import type { ExtensionResponse, OffscreenDownloadRequest } from "./messaging"

export interface CompletedDownload {
  id: number
  filename: string
}

export function normalizeDownloadFilename(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || /^[A-Za-z]:/.test(normalized) || normalized.includes(":")) {
    throw new Error("下载文件名必须是相对于 Chrome 下载目录的路径。")
  }
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("下载文件名包含无效的目录段。")
  }
  return normalized
}

export async function waitForDownload(downloadId: number, timeoutMs = 30_000): Promise<chrome.downloads.DownloadItem> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId })
    if (!item) throw new Error("Chrome 没有返回下载记录。")
    if (item.state === "complete") return item
    if (item.state === "interrupted") {
      throw new Error(`文件下载中断${item.error ? `：${item.error}` : "。"}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error("文件保存超过 30 秒仍未完成，请检查 Chrome 下载设置后重试。")
}

export async function downloadArtifact(filename: string, url: string): Promise<CompletedDownload> {
  const safeFilename = normalizeDownloadFilename(filename)
  const id = await chrome.downloads.download({
    conflictAction: "overwrite",
    filename: safeFilename,
    saveAs: false,
    url,
  })
  const item = await waitForDownload(id)
  if (!item.filename) throw new Error("Chrome 没有返回已保存文件的绝对路径。")
  return { id, filename: item.filename }
}

export async function cleanupDownloads(downloadIds: number[]): Promise<void> {
  await Promise.all(downloadIds.map(async (id) => {
    await chrome.downloads.removeFile(id).catch(() => undefined)
    await chrome.downloads.erase({ id }).catch(() => undefined)
  }))
}

export async function requestArtifactDownload(filename: string, url: string): Promise<CompletedDownload> {
  const response = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_DOWNLOAD_ARTIFACT",
    filename,
    url,
  } satisfies OffscreenDownloadRequest)) as ExtensionResponse<CompletedDownload>
  if (!response?.ok || !response.data) throw new Error(response?.error ?? "文件保存失败。")
  return response.data
}

export async function requestArtifactDownloadBlob(filename: string, blob: Blob): Promise<CompletedDownload> {
  const url = URL.createObjectURL(blob)
  try {
    return await requestArtifactDownload(filename, url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function requestDownloadCleanup(downloadIds: number[]): Promise<void> {
  if (!downloadIds.length) return
  const response = (await chrome.runtime.sendMessage({
    type: "OFFSCREEN_CLEANUP_DOWNLOADS",
    downloadIds,
  })) as ExtensionResponse
  if (!response?.ok) throw new Error(response?.error ?? "不完整下载清理失败。")
}
