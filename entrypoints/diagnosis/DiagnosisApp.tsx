import {
  AlertCircle,
  Box,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FileJson,
  Gauge,
  Globe2,
  ImageOff,
  Info,
  LoaderCircle,
  Monitor,
  Network,
  Search,
  ShieldCheck,
  TerminalSquare,
  Video,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brand } from "../../components/Brand"
import { Notice } from "../../components/Notice"
import { createExportArtifacts, downloadArtifacts, renderAnnotatedCapture } from "../../src/lib/export"
import { openCaptureRecording, readCaptureRecord, reexportCaptureRecord, updateCaptureRecordIssue } from "../../src/lib/local-artifacts"
import { reexportRemoteCaptureRecord, updateRemoteCaptureRecordIssue } from "../../src/lib/remote-artifacts"
import type { ExtensionResponse } from "../../src/lib/messaging"
import { assessReportCompleteness, buildRemoteAiContext, buildReportMarkdown, createReport } from "../../src/lib/report"
import { readRecordingResult } from "../../src/lib/recording-result-store"
import type {
  ConsoleEvidence,
  ArtifactAvailability,
  LocalArtifactLocation,
  RemoteArtifactLocation,
  NetworkEvidence,
  RootlineIssue,
  RootlineSession,
  SelectedTarget,
} from "../../src/lib/types"

type TabId = "issue" | "elements" | "console" | "network" | "environment" | "ai"
type Feedback = { tone: "error" | "success"; message: string }
type MediaMode = "screenshot" | "recording"

const TABS: Array<{ id: TabId; label: string; icon: typeof Box }> = [
  { id: "issue", label: "问题", icon: AlertCircle },
  { id: "elements", label: "元素", icon: Box },
  { id: "console", label: "控制台", icon: TerminalSquare },
  { id: "network", label: "网络", icon: Network },
  { id: "environment", label: "环境", icon: Monitor },
  { id: "ai", label: "AI 上下文", icon: Code2 },
]

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? "Rootline 操作失败。")
  return response.data as T
}

function sessionIdFromLocation(): string | null {
  return new URLSearchParams(location.search).get("session")
}

function recordFromLocation(): string | null {
  return new URLSearchParams(location.search).get("record")
}

function displayTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false })
}

function statusTone(status?: number): "success" | "warning" | "error" | "neutral" {
  if (typeof status !== "number") return "neutral"
  if (status >= 500) return "error"
  if (status >= 400) return "warning"
  return "success"
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`
  if (sizeBytes < 1_024 * 1_024) return `${(sizeBytes / 1_024).toFixed(1)} KB`
  return `${(sizeBytes / 1_024 / 1_024).toFixed(1)} MB`
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

async function persistIssue(session: RootlineSession, recordDirectory: string | null, issue: RootlineIssue): Promise<RootlineSession> {
  if (!recordDirectory) return request<RootlineSession>({ type: "UPDATE_ISSUE", sessionId: session.id, issue })
  if (session.remoteArtifacts) {
    const report = await updateRemoteCaptureRecordIssue(recordDirectory, issue)
    await request<RootlineSession>({ type: "UPDATE_ISSUE", sessionId: session.id, issue }).catch(() => undefined)
    return report
  }
  const record = await updateCaptureRecordIssue(recordDirectory, issue)
  await request<RootlineSession>({ type: "UPDATE_ISSUE", sessionId: session.id, issue }).catch(() => undefined)
  return record.report
}

export function DiagnosisApp() {
  const [session, setSession] = useState<RootlineSession | null>(null)
  const [issue, setIssue] = useState<RootlineIssue>({ description: "", expectedResult: "", notes: "" })
  const [activeTab, setActiveTab] = useState<TabId>("issue")
  const [annotatedCapture, setAnnotatedCapture] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<"copy" | "copy-link" | "export" | "open-remote" | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [dirty, setDirty] = useState(false)
  const [recordDirectory, setRecordDirectory] = useState<string | null>(null)
  const [mediaMode, setMediaMode] = useState<MediaMode>("screenshot")
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingAvailability, setRecordingAvailability] = useState<ArtifactAvailability | null>(null)
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>())
  const feedbackTimer = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

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

  useEffect(() => {
    const objectUrls: string[] = []
    let cancelled = false
    const recordDirectoryName = recordFromLocation()
    const sessionId = sessionIdFromLocation()
    if (!recordDirectoryName && !sessionId) {
      showFeedback({ tone: "error", message: "采集链接缺少记录参数。" })
      setLoading(false)
      return
    }
    const load = recordDirectoryName
      ? readCaptureRecord(recordDirectoryName).then((record) => {
          if (cancelled) return
          setRecordDirectory(recordDirectoryName)
          setSession(record.report)
          setIssue(record.report.issue)
          if (record.captureFile) {
            const captureUrl = URL.createObjectURL(record.captureFile)
            objectUrls.push(captureUrl)
            setAnnotatedCapture(captureUrl)
          }
          if (record.recordingFile) {
            const videoUrl = URL.createObjectURL(record.recordingFile)
            objectUrls.push(videoUrl)
            setRecordingUrl(videoUrl)
          } else if (record.remoteLocation?.recordingUrl) {
            setRecordingUrl(record.remoteLocation.recordingUrl)
          } else if (record.report.recording) {
            setRecordingAvailability(record.recordingState)
          }
        })
      : request<RootlineSession>({ type: "GET_SESSION", sessionId: sessionId as string }).then(async (nextSession) => {
          if (cancelled) return
          setSession(nextSession)
          setIssue(nextSession.issue)
          if (nextSession.recording) {
            const stored = await readRecordingResult(nextSession.recording.resultId)
            if (cancelled) return
            if (stored) {
              const videoUrl = URL.createObjectURL(stored.blob)
              objectUrls.push(videoUrl)
              setRecordingUrl(videoUrl)
            } else {
              setRecordingAvailability("missing")
            }
          }
        })
    void load
      .catch((error: unknown) => {
        showFeedback({ tone: "error", message: error instanceof Error ? error.message : "无法读取采集记录。" })
      })
      .finally(() => setLoading(false))
    return () => {
      cancelled = true
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [showFeedback])

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
  }, [])

  useEffect(() => {
    if (!session || recordDirectory) return
    void renderAnnotatedCapture(session)
      .then((capture) => setAnnotatedCapture(capture ?? session.screenshot.dataUrl ?? null))
      .catch(() => setAnnotatedCapture(session.screenshot.dataUrl ?? null))
  }, [recordDirectory, session])

  useEffect(() => {
    if (!session || !dirty) return
    const timeout = window.setTimeout(() => {
      void persistIssue(session, recordDirectory, issue)
        .then((nextSession) => {
          setSession(nextSession)
          setDirty(false)
        })
        .catch((error: unknown) => {
          showFeedback({ tone: "error", message: error instanceof Error ? error.message : "问题描述保存失败。" })
        })
    }, 600)
    return () => window.clearTimeout(timeout)
  }, [dirty, issue, recordDirectory, session, showFeedback])

  const updateIssue = (field: keyof RootlineIssue, value: string) => {
    setIssue((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  const saveIssue = useCallback(async (): Promise<RootlineSession> => {
    if (!session) throw new Error("采集记录尚未加载。")
    if (!dirty) return session
    const nextSession = await persistIssue(session, recordDirectory, issue)
    setSession(nextSession)
    setDirty(false)
    return nextSession
  }, [dirty, issue, recordDirectory, session])

  const copyContext = async () => {
    setBusy("copy")
    setFeedback(null)
    try {
      const nextSession = await saveIssue()
      await copyText(nextSession.remoteArtifacts ? buildRemoteAiContext(nextSession.remoteArtifacts) : buildReportMarkdown(createReport(nextSession)))
      showFeedback({ tone: "success", message: nextSession.remoteArtifacts ? "AI 上下文已复制，复用现有 COS 链接。" : "AI 上下文已复制，包含本地报告和截图路径。" })
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "复制失败。" })
    } finally {
      setBusy(null)
    }
  }

  const copyRemoteReportLink = async () => {
    const reportUrl = session?.remoteArtifacts?.reportUrl
    if (!reportUrl) return
    setBusy("copy-link")
    setFeedback(null)
    try {
      await copyText(reportUrl)
      showFeedback({ tone: "success", message: "报告链接已复制，可直接打开或粘贴给 AI。" })
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "报告链接复制失败。" })
    } finally {
      setBusy(null)
    }
  }

  const openRemoteReport = async () => {
    const reportUrl = session?.remoteArtifacts?.reportUrl
    if (!reportUrl) return
    setBusy("open-remote")
    setFeedback(null)
    try {
      await chrome.tabs.create({ url: reportUrl })
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "远程报告打开失败。" })
    } finally {
      setBusy(null)
    }
  }

  const exportReport = async () => {
    setBusy("export")
    setFeedback(null)
    try {
      const nextSession = await saveIssue()
      if (recordDirectory && nextSession.remoteArtifacts) {
        const report = await reexportRemoteCaptureRecord(recordDirectory)
        setSession(report)
        showFeedback({ tone: "success", message: "远程 report.html 已重新导出。" })
      } else if (recordDirectory) {
        const record = await reexportCaptureRecord(recordDirectory)
        setSession(record.report)
        showFeedback({ tone: "success", message: `报告已重新导出到 ${record.location?.directoryPath ?? "本地保存位置"}。` })
      } else {
        const artifacts = await createExportArtifacts(nextSession)
        await downloadArtifacts(artifacts)
        await request({ type: "MARK_EXPORTED", sessionId: nextSession.id })
        setSession({ ...nextSession, status: "exported" })
        setAnnotatedCapture(artifacts.captureDataUrl ?? nextSession.screenshot.dataUrl ?? null)
        showFeedback({ tone: "success", message: `报告已导出到 ${artifacts.directory}。` })
      }
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "重新导出失败。" })
    } finally {
      setBusy(null)
    }
  }

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: TabId) => {
    const index = TABS.findIndex((item) => item.id === current)
    let nextIndex = index
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = TABS.length - 1
    else return
    event.preventDefault()
    const next = TABS[nextIndex]
    if (!next) return
    setActiveTab(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  if (loading) {
    return <main className="diagnosis-loading"><LoaderCircle aria-hidden="true" className="animate-spin" size={22} />正在读取采集现场…</main>
  }

  if (!session) {
    return (
      <main className="diagnosis-empty">
        <Brand />
        <Notice title="无法打开采集报告" tone="error">{feedback?.message ?? "记录可能已移动、损坏或无法访问。"}</Notice>
      </main>
    )
  }

  const completeness = assessReportCompleteness({ ...session, issue })
  const markdown = buildReportMarkdown(createReport({ ...session, issue }))
  const keyframes = session.recording?.keyframes ?? []

  const seekRecording = (offsetMs: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = offsetMs / 1_000
    void videoRef.current.play().catch(() => undefined)
  }

  return (
    <main className="diagnosis-shell">
      <header className="diagnosis-header">
        <div className="diagnosis-header__identity">
          <Brand compact />
          <span aria-hidden="true" className="header-rule" />
          <div className="page-identity">
            <p className="page-identity__title">{session.page.title}</p>
            <p className="page-identity__url rl-mono">{session.page.url}</p>
          </div>
        </div>
        <div className="diagnosis-header__actions">
          <CompletenessBadge level={completeness.level} score={completeness.score} />
          {session.remoteArtifacts ? <>
            <button className="rl-button" disabled={busy !== null} onClick={() => void openRemoteReport()} type="button">
              {busy === "open-remote" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <ExternalLink aria-hidden="true" size={17} />}
              打开远程报告
            </button>
            <button className="rl-button" disabled={busy !== null} onClick={() => void copyRemoteReportLink()} type="button">
              {busy === "copy-link" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
              复制报告链接
            </button>
          </> : null}
          <button className="rl-button" disabled={busy !== null} onClick={copyContext} type="button">
            {busy === "copy" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
            复制 AI 上下文
          </button>
          <button className="rl-button rl-button--primary" disabled={busy !== null} onClick={exportReport} type="button">
            {busy === "export" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Download aria-hidden="true" size={17} />}
            重新导出报告
          </button>
        </div>
      </header>

      {feedback ? (
        <div className="feedback-strip">
          <Notice title={feedback.message} tone={feedback.tone} />
        </div>
      ) : null}

      <div className="diagnosis-workspace">
        <section aria-label="页面媒体证据" className="capture-pane">
          <div className="pane-heading">
            <div>
              <p className="pane-eyebrow">{session.remoteArtifacts ? "远程媒体证据" : "本地媒体证据"}</p>
              <h1>运行现场</h1>
            </div>
            <span className="rl-mono rl-muted text-xs">{session.page.viewport.width} × {session.page.viewport.height} @ {session.page.viewport.devicePixelRatio}x</span>
          </div>
          {session.recording ? (
            <div aria-label="媒体类型" className="media-switch" role="group">
              <button aria-pressed={mediaMode === "screenshot"} onClick={() => setMediaMode("screenshot")} type="button"><Monitor aria-hidden="true" size={15} />标注截图</button>
              <button aria-pressed={mediaMode === "recording"} onClick={() => setMediaMode("recording")} type="button"><Video aria-hidden="true" size={15} />页面录屏</button>
            </div>
          ) : null}
          <div className="capture-stage" data-media={mediaMode}>
            {mediaMode === "recording" && recordingUrl ? (
              <video controls playsInline preload="metadata" ref={videoRef} src={recordingUrl} />
            ) : mediaMode === "recording" && recordingAvailability ? (
              <div className="capture-missing">
                <ImageOff aria-hidden="true" size={28} />
                <p>{session.remoteArtifacts ? (recordingAvailability === "available" ? "录屏已保存到腾讯云 COS" : "远程录屏链接无法访问") : recordingAvailability === "available" ? "录屏保存在本地下载目录" : recordingAvailability === "unknown" ? "Chrome 下载记录已清理，无法确认录屏位置" : "报告包含录屏信息，但 capture.webm 已缺失"}</p>
                {recordingAvailability === "available" && recordDirectory ? <button className="rl-button" onClick={() => void openCaptureRecording(recordDirectory)} type="button"><Video aria-hidden="true" size={16} />{session.remoteArtifacts ? "打开远程录屏" : "打开本地录屏"}</button> : null}
              </div>
            ) : annotatedCapture ? (
              <img alt={`页面截图，标注了 ${session.targets.length} 个目标元素`} src={annotatedCapture} />
            ) : (
              <div className="capture-missing">
                <ImageOff aria-hidden="true" size={28} />
                <p>本次采集没有可用截图</p>
              </div>
            )}
          </div>
          {session.recording && mediaMode === "recording" ? (
            <div className="recording-evidence-meta">
              <span><Video aria-hidden="true" size={15} />{formatDuration(session.recording.durationMs)}</span>
              <span>{formatFileSize(session.recording.sizeBytes)}</span>
              <span>{session.recording.width} × {session.recording.height}</span>
              <span>{session.recording.frameCount} 个关键帧</span>
            </div>
          ) : null}
          {mediaMode === "recording" && keyframes.length ? (
            <div className="keyframe-timeline" aria-label="录屏关键帧时间轴">
              <div className="keyframe-track" aria-hidden="true" />
              {keyframes.map((frame, index) => (
                <button
                  aria-label={`跳转到 ${formatDuration(frame.offsetMs)}${frame.label ? `，${frame.label}` : ""}`}
                  className="keyframe-marker"
                  key={`${frame.offsetMs}-${index}`}
                  onClick={() => seekRecording(frame.offsetMs)}
                  style={{ left: `${Math.min(100, Math.max(0, frame.offsetMs / Math.max(1, session.recording?.durationMs ?? 1) * 100))}%` }}
                  title={`${formatDuration(frame.offsetMs)}${frame.label ? ` · ${frame.label}` : ""}`}
                  type="button"
                />
              ))}
            </div>
          ) : null}
          <div className="capture-meta">
            <span><Box aria-hidden="true" size={15} />{session.targets.length} 个目标元素</span>
            <span><TerminalSquare aria-hidden="true" size={15} />{session.console.length} 条控制台记录</span>
            <span><Network aria-hidden="true" size={15} />{session.network.length} 条网络记录</span>
          </div>
          {session.targets.length ? (
            <ol className="target-legend">
              {session.targets.map((target, index) => (
                <li key={target.id}>
                  <span>{index + 1}</span>
                  <button onClick={() => setActiveTab("elements")} type="button">
                    <span className="rl-mono">{target.tagName.toLowerCase()}</span>
                    <span>{target.text || target.selector}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section aria-label="采集证据" className="inspector-pane">
          <div aria-label="采集信息分类" className="tab-list" role="tablist">
            {TABS.map(({ id, icon: Icon, label }) => (
              <button
                aria-controls={`panel-${id}`}
                aria-selected={activeTab === id}
                className="tab-button"
                id={`tab-${id}`}
                key={id}
                onClick={() => setActiveTab(id)}
                onKeyDown={(event) => onTabKeyDown(event, id)}
                ref={(node) => {
                  if (node) tabRefs.current.set(id, node)
                  else tabRefs.current.delete(id)
                }}
                role="tab"
                tabIndex={activeTab === id ? 0 : -1}
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                {label}
                <TabCount id={id} session={session} />
              </button>
            ))}
          </div>

          <div aria-labelledby={`tab-${activeTab}`} className="tab-panel" id={`panel-${activeTab}`} role="tabpanel" tabIndex={0}>
            {activeTab === "issue" ? <IssuePanel completeness={completeness} issue={issue} onChange={updateIssue} remote={Boolean(session.remoteArtifacts)} saved={!dirty} /> : null}
            {activeTab === "elements" ? <ElementsPanel targets={session.targets} /> : null}
            {activeTab === "console" ? <ConsolePanel events={session.console} /> : null}
            {activeTab === "network" ? <NetworkPanel events={session.network} /> : null}
            {activeTab === "environment" ? <EnvironmentPanel session={session} /> : null}
            {activeTab === "ai" ? <AiPanel location={session.localArtifacts} remoteLocation={session.remoteArtifacts} markdown={markdown} onCopy={copyContext} /> : null}
          </div>
        </section>
      </div>
    </main>
  )
}

function CompletenessBadge({ level, score }: { level: string; score: number }) {
  return (
    <div aria-label={`采集完整度 ${score}%，${level}`} className="completeness-badge">
      <Gauge aria-hidden="true" size={17} />
      <span>完整度</span>
      <span className="rl-mono">{score}%</span>
    </div>
  )
}

function TabCount({ id, session }: { id: TabId; session: RootlineSession }) {
  const count = id === "elements" ? session.targets.length
    : id === "console" ? session.console.length
      : id === "network" ? session.network.length
        : null
  return count === null ? null : <span className="tab-count">{count}</span>
}

function IssuePanel({ completeness, issue, onChange, remote, saved }: {
  completeness: ReturnType<typeof assessReportCompleteness>
  issue: RootlineIssue
  onChange: (field: keyof RootlineIssue, value: string) => void
  remote: boolean
  saved: boolean
}) {
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="采集目标" title="描述可复现的问题">
        这些内容会放在 AI 上下文最前面。页面证据不能替代清晰的问题现象和期望结果。
      </PanelIntro>
      <div className="form-grid">
        <label className="field-label">
          <span>问题现象 <span aria-hidden="true" className="required-mark">*</span></span>
          <textarea className="rl-field" maxLength={2000} onChange={(event) => onChange("description", event.target.value)} placeholder="例如：点击保存后页面没有反馈，控制台出现 TypeError。" value={issue.description} />
          <span className="field-meta"><span>{saved ? (remote ? "已同步到 COS" : "已保存到本地") : (remote ? "正在同步到 COS…" : "正在保存…")}</span><span>{issue.description.length}/2000</span></span>
        </label>
        <label className="field-label">
          <span>期望结果 <span aria-hidden="true" className="required-mark">*</span></span>
          <textarea className="rl-field" maxLength={2000} onChange={(event) => onChange("expectedResult", event.target.value)} placeholder="例如：保存成功后更新列表，并显示成功提示。" value={issue.expectedResult} />
          <span className="field-meta"><span>说明正确行为，不要预设根因</span><span>{issue.expectedResult.length}/2000</span></span>
        </label>
        <label className="field-label form-grid__wide">
          <span>补充说明</span>
          <textarea className="rl-field rl-field--compact" maxLength={4000} onChange={(event) => onChange("notes", event.target.value)} placeholder="复现频率、账号条件、最近改动或其他必要背景。" value={issue.notes} />
          <span className="field-meta"><span>可选</span><span>{issue.notes.length}/4000</span></span>
        </label>
      </div>
      {completeness.missing.length ? (
        <Notice title={`还可补充：${completeness.missing.join("、")}`} tone="warning">缺少这些内容不会阻止导出，但会降低外部 AI 定位效率。</Notice>
      ) : (
        <Notice title="本次证据已生成" tone="success">可以复制 AI 上下文或重新导出报告。</Notice>
      )}
    </div>
  )
}

function ElementsPanel({ targets }: { targets: SelectedTarget[] }) {
  if (!targets.length) return <EmptyEvidence icon={Box} title="没有选择目标元素">报告仍可导出，但 AI 只能依赖页面、控制台和网络证据。</EmptyEvidence>
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="DOM 证据" title={`${targets.length} 个目标元素`}>元素编号与左侧标注截图一致。完整 props value 不会被采集。</PanelIntro>
      <div className="evidence-list">
        {targets.map((target, index) => <TargetEvidence index={index} key={target.id} target={target} />)}
      </div>
    </div>
  )
}

function TargetEvidence({ index, target }: { index: number; target: SelectedTarget }) {
  return (
    <details className="evidence-item" open={index === 0}>
      <summary>
        <span className="evidence-index">{index + 1}</span>
        <span className="evidence-summary">
          <span className="rl-mono">{target.tagName.toLowerCase()}</span>
          <span>{target.text || target.selector}</span>
        </span>
        <ChevronDown aria-hidden="true" className="details-chevron" size={17} />
      </summary>
      <div className="evidence-body">
        {target.annotation ? (
          <DefinitionGrid items={[
            ["实际表现", target.annotation.actualResult],
            ["期望结果", target.annotation.expectedResult],
          ]} />
        ) : null}
        <DefinitionGrid items={[
          ["Selector", target.selector],
          ["XPath", target.xpath],
          ["祖先路径", target.ancestorPath],
          ["位置", `${target.rect.x}, ${target.rect.y} · ${target.rect.width} × ${target.rect.height}`],
          ["Role", target.role ?? "未设置"],
          ["data-testid", target.testId ?? "未设置"],
        ]} />
        <EvidenceBlock title="DOM 摘要" value={target.dom} />
        <EvidenceBlock title="关键计算样式" value={JSON.stringify(target.computedStyle, null, 2)} />
        {target.beforeStyle ? <EvidenceBlock title="::before 样式" value={JSON.stringify(target.beforeStyle, null, 2)} /> : null}
        {target.afterStyle ? <EvidenceBlock title="::after 样式" value={JSON.stringify(target.afterStyle, null, 2)} /> : null}
        <div className="subsection">
          <h3>React 运行提示</h3>
          {target.react?.available ? (
            <DefinitionGrid items={[
              ["组件链", target.react.componentChain.join(" > ") || "未识别组件名称"],
              ["Props Keys", target.react.propsKeys.join(", ") || "无"],
            ]} />
          ) : <p className="rl-muted m-0">{target.react?.boundary ?? "没有可用的 React 元数据。"}</p>}
        </div>
        <div className="subsection">
          <h3>匹配 CSS 规则</h3>
          {target.cssRules.length ? target.cssRules.map((rule, ruleIndex) => (
            <EvidenceBlock key={`${rule.selector}-${ruleIndex}`} title={`${rule.selector}${rule.styleSheetUrl ? ` · ${rule.styleSheetUrl}` : ""}`} value={rule.cssText} />
          )) : <p className="rl-muted m-0">未读取到可访问的同源匹配规则。</p>}
        </div>
      </div>
    </details>
  )
}

function ConsolePanel({ events }: { events: ConsoleEvidence[] }) {
  const [level, setLevel] = useState<"all" | ConsoleEvidence["level"]>("all")
  const [query, setQuery] = useState("")
  const filtered = events.filter((item) => (level === "all" || item.level === level) && `${item.message} ${item.stack ?? ""}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="Console" title={`${events.length} 条采集记录`}>仅包含采集启动后的日志、页面错误和未处理 Promise rejection。</PanelIntro>
      <EvidenceFilters query={query} setQuery={setQuery}>
        <SegmentedControl label="日志级别" onChange={(value) => setLevel(value as typeof level)} options={[
          ["all", "全部"], ["error", "错误"], ["warn", "警告"], ["info", "信息"],
        ]} value={level} />
      </EvidenceFilters>
      {filtered.length ? <div className="evidence-list">{filtered.map((item) => <ConsoleItem item={item} key={item.id} />)}</div>
        : <EmptyEvidence icon={TerminalSquare} title="没有匹配的控制台记录">调整筛选条件后重试。</EmptyEvidence>}
    </div>
  )
}

function ConsoleItem({ item }: { item: ConsoleEvidence }) {
  return (
    <details className="evidence-item console-item" data-level={item.level} open={item.level === "error"}>
      <summary>
        <span className="level-badge">{item.level}</span>
        <span className="evidence-summary"><span>{item.message}</span><span>{displayTime(item.timestamp)}</span></span>
        <ChevronDown aria-hidden="true" className="details-chevron" size={17} />
      </summary>
      <div className="evidence-body">
        <EvidenceBlock title="消息" value={item.message} />
        {item.stack ? <EvidenceBlock title="堆栈" value={item.stack} /> : null}
        {item.truncated ? <p className="truncated-note">该记录已按 4 KB 上限截断。</p> : null}
      </div>
    </details>
  )
}

function NetworkPanel({ events }: { events: NetworkEvidence[] }) {
  const [type, setType] = useState<"all" | NetworkEvidence["type"]>("all")
  const [query, setQuery] = useState("")
  const filtered = events.filter((item) => (type === "all" || item.type === type) && `${item.method} ${item.url} ${item.status ?? ""}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="Network" title={`${events.length} 条请求与资源`}>fetch、XHR 包含脱敏预览；其他资源来自 Resource Timing。</PanelIntro>
      <EvidenceFilters query={query} setQuery={setQuery}>
        <SegmentedControl label="请求类型" onChange={(value) => setType(value as typeof type)} options={[
          ["all", "全部"], ["fetch", "Fetch"], ["xhr", "XHR"], ["resource", "资源"],
        ]} value={type} />
      </EvidenceFilters>
      {filtered.length ? <div className="evidence-list">{filtered.map((item) => <NetworkItem item={item} key={item.id} />)}</div>
        : <EmptyEvidence icon={Network} title="没有匹配的网络记录">调整筛选条件后重试。</EmptyEvidence>}
    </div>
  )
}

function NetworkItem({ item }: { item: NetworkEvidence }) {
  const tone = statusTone(item.status)
  return (
    <details className="evidence-item network-item" open={tone === "error"}>
      <summary>
        <span className="method-badge">{item.method}</span>
        <span className="evidence-summary"><span>{item.url}</span><span>{item.type}{item.resourceType ? ` · ${item.resourceType}` : ""} · {displayTime(item.timestamp)}</span></span>
        <span className="status-badge" data-tone={tone}>{item.status ?? "—"}</span>
        <span className="duration-badge">{typeof item.duration === "number" ? `${Math.round(item.duration)} ms` : "—"}</span>
        <ChevronDown aria-hidden="true" className="details-chevron" size={17} />
      </summary>
      <div className="evidence-body">
        {item.error ? <Notice title={item.error} tone="error" /> : null}
        {item.requestHeaders ? <EvidenceBlock title="请求 Headers" value={JSON.stringify(item.requestHeaders, null, 2)} /> : null}
        {item.requestBody ? <EvidenceBlock title={`请求体${item.requestBodyTruncated ? " · 已截断" : ""}`} value={item.requestBody} /> : null}
        {item.responseHeaders ? <EvidenceBlock title="响应 Headers" value={JSON.stringify(item.responseHeaders, null, 2)} /> : null}
        {item.responseBody ? <EvidenceBlock title={`响应体${item.responseBodyTruncated ? " · 已截断" : ""}`} value={item.responseBody} /> : null}
        {!item.requestBody && !item.responseBody && !item.requestHeaders && !item.responseHeaders ? <p className="rl-muted m-0">该 Resource Timing 记录不包含请求和响应正文。</p> : null}
      </div>
    </details>
  )
}

function EnvironmentPanel({ session }: { session: RootlineSession }) {
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="Environment" title="页面与采集边界">Rootline 不申请 Cookie、webRequest、debugger 或全站访问权限。</PanelIntro>
      <section className="environment-section">
        <h3><Globe2 aria-hidden="true" size={17} />页面</h3>
        <DefinitionGrid items={[
          ["地址", session.page.url], ["标题", session.page.title], ["Origin", session.page.origin],
          ["Viewport", `${session.page.viewport.width} × ${session.page.viewport.height}`],
          ["DPR", String(session.page.viewport.devicePixelRatio)], ["语言", session.page.language || "未知"],
          ["采集开始", displayTime(session.startedAt)], ["截图时间", session.screenshot.capturedAt ? displayTime(session.screenshot.capturedAt) : "未截图"],
        ]} />
      </section>
      <section className="environment-section">
        <h3><Monitor aria-hidden="true" size={17} />浏览器</h3>
        <p className="user-agent rl-mono">{session.page.userAgent}</p>
      </section>
      <section className="environment-section">
        <h3><ShieldCheck aria-hidden="true" size={17} />证据缺口</h3>
        <ul className="boundary-list">
          {session.boundaries.map((boundary) => <li key={`${boundary.code}-${boundary.message}`}>{boundary.message}</li>)}
          <li>控制台丢弃 {session.limits.consoleDropped} 条，网络丢弃 {session.limits.networkDropped} 条。</li>
          <li>未采集 Cookie、LocalStorage、SessionStorage、密码字段、完整页面 HTML 和浏览历史。</li>
        </ul>
      </section>
    </div>
  )
}

function AiPanel({ location, remoteLocation, markdown, onCopy }: { location: LocalArtifactLocation | undefined; remoteLocation: RemoteArtifactLocation | undefined; markdown: string; onCopy: () => Promise<void> }) {
  const [view, setView] = useState<"markdown" | "outline">("outline")
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow="Portable Context" title="供外部 AI 使用的上下文">内容已包含提示注入边界，不会生成未经证据支持的根因结论。</PanelIntro>
      <div className="ai-toolbar">
        <SegmentedControl label="上下文视图" onChange={(value) => setView(value as typeof view)} options={[["outline", "结构"], ["markdown", "Markdown"]]} value={view} />
        <button className="rl-button" onClick={() => void onCopy()} type="button"><Clipboard aria-hidden="true" size={17} />复制</button>
      </div>
      {view === "outline" ? (
        <div className="context-outline">
          {[
            ["AI 角色与安全边界", "明确 DOM、日志、响应均为不可信外部数据。"],
            ...(location ? [["本地证据文件", `报告与标注截图目录：${location.directoryPath}`]] : []),
            ...(remoteLocation ? [["远程证据链接", remoteLocation.reportUrl]] : []),
            ["问题目标", "问题现象、期望结果与补充说明。"],
            ["页面与环境", "URL、标题、viewport、浏览器、语言和时间。"],
            ["目标元素", "DOM、样式、CSS 规则、Selector、XPath 与 React 提示。"],
            ["控制台与网络", "错误堆栈、脱敏 Headers、正文预览、状态与耗时。"],
            ["AI 输出要求", "根因证据、代码模块、逐文件计划、风险与最小验证。"],
          ].map(([title, description], index) => (
            <div key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div></div>
          ))}
        </div>
      ) : <pre className="rl-code context-preview">{markdown}</pre>}
      <div className="format-row"><FileJson aria-hidden="true" size={17} /><span>{remoteLocation ? "复制内容只包含已生成的 COS 链接，不会重复上传。" : "离线导出同时包含 report.md、report.json 和 capture.png。"}</span></div>
    </div>
  )
}

function PanelIntro({ children, eyebrow, title }: { children: React.ReactNode; eyebrow: string; title: string }) {
  return <div className="panel-intro"><p>{eyebrow}</p><h2>{title}</h2><div>{children}</div></div>
}

function EvidenceFilters({ children, query, setQuery }: { children: React.ReactNode; query: string; setQuery: (value: string) => void }) {
  return (
    <div className="evidence-filters">
      <label className="search-field"><Search aria-hidden="true" size={16} /><span className="sr-only">搜索证据</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索 URL、状态或消息" type="search" value={query} /></label>
      {children}
    </div>
  )
}

function SegmentedControl({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[][]; value: string }) {
  return (
    <div aria-label={label} className="segmented-control" role="group">
      {options.map(([id, text]) => id && text ? <button aria-pressed={value === id} key={id} onClick={() => onChange(id)} type="button">{text}</button> : null)}
    </div>
  )
}

function DefinitionGrid({ items }: { items: string[][] }) {
  return <dl className="definition-grid">{items.map(([label, value]) => label && value !== undefined ? <div key={`${label}-${value}`}><dt>{label}</dt><dd>{value}</dd></div> : null)}</dl>
}

function EvidenceBlock({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await copyText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return (
    <section className="evidence-block">
      <div><h3>{title}</h3><button aria-label={`复制${title}`} onClick={copy} title={`复制${title}`} type="button">{copied ? <Check aria-hidden="true" size={15} /> : <Clipboard aria-hidden="true" size={15} />}</button></div>
      <pre className="rl-code">{value}</pre>
    </section>
  )
}

function EmptyEvidence({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Info; title: string }) {
  return <div className="empty-evidence"><Icon aria-hidden="true" size={24} /><h3>{title}</h3><p>{children}</p></div>
}
