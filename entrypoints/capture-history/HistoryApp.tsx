import {
  ClipboardCopy,
  ExternalLink,
  FileOutput,
  History,
  RefreshCw,
  Search,
  Video,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brand } from "../../components/Brand"
import { Notice } from "../../components/Notice"
import { listCaptureHistory, openCaptureRecording, readCaptureRecord, reexportCaptureRecord } from "../../src/lib/local-artifacts"
import { reexportRemoteCaptureRecord } from "../../src/lib/remote-artifacts"
import { assessReportCompleteness, buildRemoteAiContext, buildReportMarkdown } from "../../src/lib/report"
import type { CaptureHistoryItem } from "../../src/lib/local-artifacts"

type Feedback = { tone: "success" | "error"; message: string }

function displayTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.append(textarea)
    textarea.select()
    document.execCommand("copy")
    textarea.remove()
  }
}

export function HistoryApp() {
  const [records, setRecords] = useState<CaptureHistoryItem[]>([])
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackTimer = useRef<number | null>(null)

  const showFeedback = useCallback((next: Feedback) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    setFeedback(next)
    feedbackTimer.current = next.tone === "success"
      ? window.setTimeout(() => {
          setFeedback(null)
          feedbackTimer.current = null
        }, 3_000)
      : null
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
  }, [])

  const refresh = useCallback(async () => {
    setRecords(await listCaptureHistory())
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : "无法读取采集历史。" }))
  }, [refresh, showFeedback])

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label)
    setFeedback(null)
    try {
      await operation()
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "Rootline 操作失败。" })
    } finally {
      setBusy(null)
    }
  }

  const openRecord = async (directoryName: string) => {
    const item = records.find((entry) => entry.directoryName === directoryName)
    await chrome.tabs.create({ url: item?.remoteLocation?.reportUrl ?? chrome.runtime.getURL(`capture.html?record=${encodeURIComponent(directoryName)}`) })
  }

  const copyRecord = (directoryName: string) => run(`copy:${directoryName}`, async () => {
    const record = await readCaptureRecord(directoryName)
    await copyText(record.remoteLocation ? buildRemoteAiContext(record.remoteLocation) : buildReportMarkdown(record.report))
    showFeedback({ tone: "success", message: record.remoteLocation ? "AI 上下文已复制，复用现有 COS 链接。" : "AI 上下文已复制，包含本地证据的绝对路径。" })
  })

  const reexportRecord = (directoryName: string) => run(`export:${directoryName}`, async () => {
    const record = await readCaptureRecord(directoryName)
    if (record.remoteLocation) await reexportRemoteCaptureRecord(directoryName)
    else await reexportCaptureRecord(directoryName)
    await refresh()
    showFeedback({ tone: "success", message: record.remoteLocation ? "远程 report.html 已重新导出。" : "报告已在原保存位置重新导出。" })
  })

  const openRecording = (directoryName: string) => run(`recording:${directoryName}`, async () => {
    const state = await openCaptureRecording(directoryName)
    if (state === "missing") throw new Error("本地录屏文件已经缺失。")
    if (state === "unknown") throw new Error("Chrome 下载记录已被清理，无法确认录屏文件位置。")
  })

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return records
    return records.filter((item) => [item.directoryName, item.report?.page.title, item.report?.page.url]
      .some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [query, records])

  return (
    <main className="history-shell">
      <header className="history-header">
        <Brand />
        <button aria-label="刷新历史" className="rl-button rl-icon-button" disabled={busy !== null} onClick={() => void refresh()} title="刷新历史" type="button">
          <RefreshCw aria-hidden="true" size={17} />
        </button>
      </header>

      {feedback ? <Notice title={feedback.message} tone={feedback.tone} /> : null}

      <section className="history-section" aria-labelledby="history-title">
        <div className="history-section__heading">
          <div><p className="section-kicker">Evidence</p><h1 id="history-title">采集历史</h1></div>
          <span>{records.length} 条</span>
        </div>

        <label className="history-search"><Search aria-hidden="true" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索页面、域名或目录" value={query} /></label>

        {filtered.length === 0 ? <div className="history-empty"><History aria-hidden="true" size={22} /><p>{query ? "没有匹配的采集记录。" : "还没有采集记录。完成一次采集后，Rootline 会在这里保留本地索引。"}</p></div> : null}
        <div className="history-list">
          {filtered.map((item) => item.state === "ready" && item.report && (item.location || item.remoteLocation) ? (
            <article className="history-record" key={item.directoryName}>
              <div className="history-record__main"><div><p className="history-record__title">{item.report.page.title}</p><p className="history-record__url">{item.report.page.url}</p></div><time>{displayTime(item.report.generatedAt)}</time></div>
              <div className="history-record__metrics">
                {item.report.recording ? <span className="recording-metric" data-missing={item.recordingState === "missing" || undefined}><Video aria-hidden="true" size={13} />{item.recordingState === "available" ? `录屏 ${formatDuration(item.report.recording.durationMs)}` : item.recordingState === "missing" ? "录屏文件缺失" : "录屏位置无法确认"}</span> : <span>标注截图</span>}
                {item.remoteLocation ? <span data-error={item.markdownState === "missing" || undefined}>{item.markdownState === "available" ? "远程链接可访问" : item.markdownState === "missing" ? "远程链接无法访问" : "远程链接待确认"}</span> : null}
                <span>{assessReportCompleteness(item.report).score}% 完整度</span>
                <span>{item.report.targets.length} 个元素</span>
                <span data-error={item.report.console.some((entry) => entry.level === "error") || undefined}>{item.report.console.filter((entry) => entry.level === "error").length} 个错误</span>
                <span>{item.report.network.length} 个请求</span>
              </div>
              <code className="history-record__path">{item.remoteLocation?.reportUrl ?? item.location?.directoryPath}</code>
              <div className="history-record__actions">
                <button className="rl-button rl-button--primary" onClick={() => void openRecord(item.directoryName)} type="button"><ExternalLink aria-hidden="true" size={16} />查看报告</button>
                {item.report.recording && (item.remoteLocation?.recordingUrl || typeof item.location?.downloadIds?.recording === "number") ? <button className="rl-button" disabled={busy !== null || item.recordingState !== "available"} onClick={() => void openRecording(item.directoryName)} type="button"><Video aria-hidden="true" size={16} />打开录屏</button> : null}
                <button className="rl-button" disabled={busy !== null} onClick={() => void copyRecord(item.directoryName)} type="button"><ClipboardCopy aria-hidden="true" size={16} />复制 AI 上下文</button>
                <button className="rl-button" disabled={busy !== null} onClick={() => void reexportRecord(item.directoryName)} type="button"><FileOutput aria-hidden="true" size={16} />重新导出报告</button>
              </div>
            </article>
          ) : (
            <article className="history-record history-record--invalid" key={item.directoryName}><p className="history-record__title">无法读取采集记录</p><code className="history-record__path">{item.directoryName}</code><p>{item.error}</p></article>
          ))}
        </div>
      </section>
    </main>
  )
}
