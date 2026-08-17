import { buildReportDirectoryName, buildReportMarkdown, createReport, serializeReportJson } from "./report"
import type { RootlineReportV1, RootlineSession } from "./types"

export interface ExportArtifacts {
  directory: string
  markdown: string
  json: string
  captureDataUrl?: string
  report: RootlineReportV1
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("无法读取页面截图。"))
    image.src = dataUrl
  })
}

export async function renderAnnotatedCapture(session: RootlineSession): Promise<string | undefined> {
  if (!session.screenshot.dataUrl) return undefined
  const image = await loadImage(session.screenshot.dataUrl)
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器无法创建截图画布。")
  context.drawImage(image, 0, 0)
  const scaleX = image.naturalWidth / Math.max(session.page.viewport.width, 1)
  const scaleY = image.naturalHeight / Math.max(session.page.viewport.height, 1)
  const lineWidth = Math.max(2, Math.round(2 * Math.min(scaleX, scaleY)))
  const labelSize = Math.max(18, Math.round(18 * Math.min(scaleX, scaleY)))
  context.font = `700 ${labelSize}px system-ui, sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  session.targets.forEach((target, index) => {
    const x = Math.max(0, target.rect.x * scaleX)
    const y = Math.max(0, target.rect.y * scaleY)
    const width = Math.max(lineWidth, target.rect.width * scaleX)
    const height = Math.max(lineWidth, target.rect.height * scaleY)
    context.fillStyle = "rgba(34, 197, 94, 0.14)"
    context.fillRect(x, y, width, height)
    context.strokeStyle = "#16a34a"
    context.lineWidth = lineWidth
    context.strokeRect(x, y, width, height)
    const radius = Math.max(13, labelSize * 0.75)
    const centerX = Math.min(image.naturalWidth - radius, Math.max(radius, x + radius))
    const centerY = Math.min(image.naturalHeight - radius, Math.max(radius, y + radius))
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, Math.PI * 2)
    context.fillStyle = "#171b1a"
    context.fill()
    context.fillStyle = "#86efac"
    context.fillText(String(index + 1), centerX, centerY + 1)
  })
  return canvas.toDataURL("image/png")
}

export async function createExportArtifacts(session: RootlineSession, now = new Date()): Promise<ExportArtifacts> {
  const captureDataUrl = await renderAnnotatedCapture(session)
  const report = createReport({
    ...session,
    screenshot: {
      ...session.screenshot,
      ...(captureDataUrl ? { markedDataUrl: captureDataUrl } : {}),
      ...(captureDataUrl ? {
        fileName: "capture.png",
        width: session.page.viewport.width,
        height: session.page.viewport.height,
      } : {}),
    },
  })
  return {
    directory: buildReportDirectoryName(now),
    markdown: buildReportMarkdown(report),
    json: serializeReportJson(report),
    ...(captureDataUrl ? { captureDataUrl } : {}),
    report,
  }
}

async function downloadUrl(filename: string, url: string): Promise<number> {
  return chrome.downloads.download({ filename, url, conflictAction: "uniquify", saveAs: false })
}

async function downloadText(filename: string, content: string, type: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type }))
  try {
    await downloadUrl(filename, url)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

export async function downloadArtifacts(artifacts: ExportArtifacts): Promise<void> {
  await downloadText(`${artifacts.directory}/report.md`, artifacts.markdown, "text/markdown;charset=utf-8")
  await downloadText(`${artifacts.directory}/report.json`, artifacts.json, "application/json;charset=utf-8")
  if (artifacts.captureDataUrl) await downloadUrl(`${artifacts.directory}/capture.png`, artifacts.captureDataUrl)
}
