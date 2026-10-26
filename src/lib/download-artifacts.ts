import { t } from "./i18n"
import type { ExtensionResponse, OffscreenDownloadRequest } from "./messaging"

export interface CompletedDownload {
  id: number
  filename: string
}

export function normalizeDownloadFilename(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+/, "")
  if (!normalized || /^[A-Za-z]:/.test(normalized) || normalized.includes(":")) {
    throw new Error(t("errorDownloadFilename"))
  }
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(t("errorDownloadFilenameSegment"))
  }
  return normalized
}

export async function waitForDownload(downloadId: number, timeoutMs = 30_000): Promise<chrome.downloads.DownloadItem> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId })
    if (!item) throw new Error(t("errorDownloadRecordMissing"))
    if (item.state === "complete") return item
    if (item.state === "interrupted") {
      throw new Error(item.error ? t("errorDownloadInterrupted", { detail: item.error }) : t("errorDownloadInterruptedBare"))
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(t("errorDownloadTimeout"))
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
  if (!item.filename) throw new Error(t("errorDownloadPathMissing"))
  return { id, filename: item.filename }
}

export async function downloadArtifactUrl(filename: string, url: string): Promise<CompletedDownload> {
  const parsed = new URL(url)
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(t("errorRemoteUrlProtocol"))
  const safeFilename = normalizeDownloadFilename(filename)
  const id = await chrome.downloads.download({
    conflictAction: "overwrite",
    filename: safeFilename,
    saveAs: false,
    url: parsed.toString(),
  })
  const item = await waitForDownload(id)
  if (!item.filename) throw new Error(t("errorDownloadPathMissing"))
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
  if (!response?.ok || !response.data) throw new Error(response?.error ?? t("errorFileSaveFailed"))
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
  if (!response?.ok) throw new Error(response?.error ?? t("errorDownloadCleanupFailed"))
}
