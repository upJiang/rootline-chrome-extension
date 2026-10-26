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
import { LocaleToggle, useI18n } from "../../components/LocaleToggle"
import { Notice } from "../../components/Notice"
import { formatDateTime, getLocale, localizeKnownCopy, providerName, t, type MessageKey } from "../../src/lib/i18n"
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

const TABS: Array<{ id: TabId; label: MessageKey; icon: typeof Box }> = [
  { id: "issue", label: "diagnosisTabIssue", icon: AlertCircle },
  { id: "elements", label: "diagnosisTabElements", icon: Box },
  { id: "console", label: "diagnosisTabConsole", icon: TerminalSquare },
  { id: "network", label: "diagnosisTabNetwork", icon: Network },
  { id: "environment", label: "diagnosisTabEnvironment", icon: Monitor },
  { id: "ai", label: "diagnosisTabAi", icon: Code2 },
]

const MISSING_LABELS = {
  "问题现象": "diagnosisMissingSymptom",
  "期望结果": "diagnosisMissingExpected",
  "目标元素": "diagnosisMissingTargets",
  "页面截图": "diagnosisMissingScreenshot",
  "录屏文件": "diagnosisMissingRecording",
  "控制台或网络事件": "diagnosisMissingEvents",
} as const satisfies Record<string, MessageKey>

const LEVEL_LABELS = {
  "完整": "diagnosisLevelComplete",
  "可用": "diagnosisLevelUsable",
  "待补充": "diagnosisLevelIncomplete",
} as const satisfies Record<string, MessageKey>

function translateMissing(items: string[]): string {
  return items.map((item) => (item in MISSING_LABELS ? t(MISSING_LABELS[item as keyof typeof MISSING_LABELS]) : item)).join(getLocale() === "en" ? ", " : "、")
}

function translateLevel(level: string): string {
  return level in LEVEL_LABELS ? t(LEVEL_LABELS[level as keyof typeof LEVEL_LABELS]) : level
}

function boundaryText(boundary: { code: string; message: string }): string {
  switch (boundary.code) {
    case "capture-window": return t("boundaryCaptureWindow")
    case "privacy": return t("boundaryPrivacy")
    case "frame-boundary": return t("boundaryFrame")
    case "snapshot-unavailable": return t("boundarySnapshotUnavailable")
    case "remote-history-unavailable": return t("boundaryRemoteHistory")
    default: return localizeKnownCopy(boundary.message)
  }
}

function frameLabel(label: string): string {
  const match = /^(?:标注元素|Mark) (\d+)$/.exec(label)
  return match?.[1] ? t("recordingFrameLabel", { index: match[1] }) : localizeKnownCopy(label)
}

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? t("commonOperationFailed"))
  return response.data as T
}

function sessionIdFromLocation(): string | null {
  return new URLSearchParams(location.search).get("session")
}

function recordFromLocation(): string | null {
  return new URLSearchParams(location.search).get("record")
}

function displayTime(value: string): string {
  return formatDateTime(value)
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
  const { locale } = useI18n()
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
      showFeedback({ tone: "error", message: t("diagnosisMissingRecord") })
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
        showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("diagnosisReadFailed") })
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
    document.title = t("diagnosisDocumentTitle")
  }, [locale])

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
          showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("diagnosisSaveIssueFailed") })
        })
    }, 600)
    return () => window.clearTimeout(timeout)
  }, [dirty, issue, recordDirectory, session, showFeedback])

  const updateIssue = (field: keyof RootlineIssue, value: string) => {
    setIssue((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  const saveIssue = useCallback(async (): Promise<RootlineSession> => {
    if (!session) throw new Error(t("diagnosisSessionNotLoaded"))
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
      showFeedback({ tone: "success", message: nextSession.remoteArtifacts ? t("diagnosisContextCopiedRemote") : t("diagnosisContextCopiedLocal") })
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("commonCopyFailed") })
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
      showFeedback({ tone: "success", message: t("diagnosisLinkCopied") })
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("diagnosisLinkCopyFailed") })
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
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("diagnosisRemoteOpenFailed") })
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
        showFeedback({ tone: "success", message: t("diagnosisRemoteExported") })
      } else if (recordDirectory) {
        const record = await reexportCaptureRecord(recordDirectory)
        setSession(record.report)
        showFeedback({ tone: "success", message: t("diagnosisExportedTo", { path: record.location?.directoryPath ?? t("diagnosisLocalSave") }) })
      } else {
        const artifacts = await createExportArtifacts(nextSession)
        await downloadArtifacts(artifacts)
        await request({ type: "MARK_EXPORTED", sessionId: nextSession.id })
        setSession({ ...nextSession, status: "exported" })
        setAnnotatedCapture(artifacts.captureDataUrl ?? nextSession.screenshot.dataUrl ?? null)
        showFeedback({ tone: "success", message: t("diagnosisExportedDir", { directory: artifacts.directory }) })
      }
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("diagnosisExportFailed") })
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
    return <main className="diagnosis-loading"><LoaderCircle aria-hidden="true" className="animate-spin" size={22} />{t("diagnosisLoading")}</main>
  }

  if (!session) {
    return (
      <main className="diagnosis-empty">
        <Brand />
        <Notice title={t("diagnosisOpenFailed")} tone="error">{feedback?.message ? localizeKnownCopy(feedback.message) : t("diagnosisRecordUnavailable")}</Notice>
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
          <LocaleToggle />
          <CompletenessBadge level={translateLevel(completeness.level)} score={completeness.score} />
          {session.remoteArtifacts ? <>
            <button className="rl-button" disabled={busy !== null} onClick={() => void openRemoteReport()} type="button">
              {busy === "open-remote" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <ExternalLink aria-hidden="true" size={17} />}
              {t("diagnosisOpenRemote")}
            </button>
            <button className="rl-button" disabled={busy !== null} onClick={() => void copyRemoteReportLink()} type="button">
              {busy === "copy-link" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
              {t("diagnosisCopyLink")}
            </button>
          </> : null}
          <button className="rl-button" disabled={busy !== null} onClick={copyContext} type="button">
            {busy === "copy" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Clipboard aria-hidden="true" size={17} />}
            {t("diagnosisCopyContext")}
          </button>
          <button className="rl-button rl-button--primary" disabled={busy !== null} onClick={exportReport} type="button">
            {busy === "export" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Download aria-hidden="true" size={17} />}
            {t("diagnosisExportAgain")}
          </button>
        </div>
      </header>

      {feedback ? (
        <div className="feedback-strip">
          <Notice title={localizeKnownCopy(feedback.message)} tone={feedback.tone} />
        </div>
      ) : null}

      <div className="diagnosis-workspace">
        <section aria-label={t("diagnosisMediaEvidence")} className="capture-pane">
          <div className="pane-heading">
            <div>
              <p className="pane-eyebrow">{session.remoteArtifacts ? t("diagnosisRemoteMedia") : t("diagnosisLocalMedia")}</p>
              <h1>{t("diagnosisRuntimeTitle")}</h1>
            </div>
            <span className="rl-mono rl-muted text-xs">{session.page.viewport.width} × {session.page.viewport.height} @ {session.page.viewport.devicePixelRatio}x</span>
          </div>
          {session.recording ? (
            <div aria-label={t("diagnosisMediaType")} className="media-switch" role="group">
              <button aria-pressed={mediaMode === "screenshot"} onClick={() => setMediaMode("screenshot")} type="button"><Monitor aria-hidden="true" size={15} />{t("diagnosisAnnotatedShot")}</button>
              <button aria-pressed={mediaMode === "recording"} onClick={() => setMediaMode("recording")} type="button"><Video aria-hidden="true" size={15} />{t("diagnosisPageRecording")}</button>
            </div>
          ) : null}
          <div className="capture-stage" data-media={mediaMode}>
            {mediaMode === "recording" && recordingUrl ? (
              <video controls playsInline preload="metadata" ref={videoRef} src={recordingUrl} />
            ) : mediaMode === "recording" && recordingAvailability ? (
              <div className="capture-missing">
                <ImageOff aria-hidden="true" size={28} />
                <p>{session.remoteArtifacts ? (recordingAvailability === "available" ? t("diagnosisRecordingOnProvider", { provider: providerName(session.remoteArtifacts.provider) }) : t("diagnosisRemoteRecordingUnavailable")) : recordingAvailability === "available" ? t("diagnosisRecordingInDownloads") : recordingAvailability === "unknown" ? t("diagnosisRecordingUnknown") : t("diagnosisRecordingMissing")}</p>
                {recordingAvailability === "available" && recordDirectory ? <button className="rl-button" onClick={() => void openCaptureRecording(recordDirectory)} type="button"><Video aria-hidden="true" size={16} />{session.remoteArtifacts ? t("diagnosisOpenRemoteRecording") : t("diagnosisOpenLocalRecording")}</button> : null}
              </div>
            ) : annotatedCapture ? (
              <img alt={t("diagnosisShotAlt", { count: session.targets.length })} src={annotatedCapture} />
            ) : (
              <div className="capture-missing">
                <ImageOff aria-hidden="true" size={28} />
                <p>{t("diagnosisNoScreenshot")}</p>
              </div>
            )}
          </div>
          {session.recording && mediaMode === "recording" ? (
            <div className="recording-evidence-meta">
              <span><Video aria-hidden="true" size={15} />{formatDuration(session.recording.durationMs)}</span>
              <span>{formatFileSize(session.recording.sizeBytes)}</span>
              <span>{session.recording.width} × {session.recording.height}</span>
              <span>{t("diagnosisKeyframeCount", { count: session.recording.frameCount })}</span>
            </div>
          ) : null}
          {mediaMode === "recording" && keyframes.length ? (
            <div className="keyframe-timeline" aria-label={t("diagnosisKeyframeTimeline")}>
              <div className="keyframe-track" aria-hidden="true" />
              {keyframes.map((frame, index) => (
                <button
                  aria-label={t("diagnosisSeek", { time: formatDuration(frame.offsetMs), label: frame.label ? t("diagnosisSeekLabel", { label: frameLabel(frame.label) }) : "" })}
                  className="keyframe-marker"
                  key={`${frame.offsetMs}-${index}`}
                  onClick={() => seekRecording(frame.offsetMs)}
                  style={{ left: `${Math.min(100, Math.max(0, frame.offsetMs / Math.max(1, session.recording?.durationMs ?? 1) * 100))}%` }}
                  title={`${formatDuration(frame.offsetMs)}${frame.label ? ` · ${frameLabel(frame.label)}` : ""}`}
                  type="button"
                />
              ))}
            </div>
          ) : null}
          <div className="capture-meta">
            <span><Box aria-hidden="true" size={15} />{t("diagnosisTargetCount", { count: session.targets.length })}</span>
            <span><TerminalSquare aria-hidden="true" size={15} />{t("diagnosisConsoleCount", { count: session.console.length })}</span>
            <span><Network aria-hidden="true" size={15} />{t("diagnosisNetworkCount", { count: session.network.length })}</span>
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

        <section aria-label={t("diagnosisEvidence")} className="inspector-pane">
          <div aria-label={t("diagnosisTabs")} className="tab-list" role="tablist">
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
                {t(label)}
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
    <div aria-label={t("diagnosisCompleteness", { score, level })} className="completeness-badge">
      <Gauge aria-hidden="true" size={17} />
      <span>{t("diagnosisCompletenessShort")}</span>
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
      <PanelIntro eyebrow={t("diagnosisIssueEyebrow")} title={t("diagnosisIssueTitle")}>
        {t("diagnosisIssueIntro")}
      </PanelIntro>
      <div className="form-grid">
        <label className="field-label">
          <span>{t("diagnosisSymptom")} <span aria-hidden="true" className="required-mark">*</span></span>
          <textarea className="rl-field" maxLength={2000} onChange={(event) => onChange("description", event.target.value)} placeholder={t("diagnosisSymptomPlaceholder")} value={issue.description} />
          <span className="field-meta"><span>{saved ? (remote ? t("diagnosisSyncedRemote") : t("diagnosisSavedLocal")) : (remote ? t("diagnosisSyncingRemote") : t("diagnosisSaving"))}</span><span>{issue.description.length}/2000</span></span>
        </label>
        <label className="field-label">
          <span>{t("diagnosisExpected")} <span aria-hidden="true" className="required-mark">*</span></span>
          <textarea className="rl-field" maxLength={2000} onChange={(event) => onChange("expectedResult", event.target.value)} placeholder={t("diagnosisExpectedPlaceholder")} value={issue.expectedResult} />
          <span className="field-meta"><span>{t("diagnosisExpectedHint")}</span><span>{issue.expectedResult.length}/2000</span></span>
        </label>
        <label className="field-label form-grid__wide">
          <span>{t("diagnosisNotes")}</span>
          <textarea className="rl-field rl-field--compact" maxLength={4000} onChange={(event) => onChange("notes", event.target.value)} placeholder={t("diagnosisNotesPlaceholder")} value={issue.notes} />
          <span className="field-meta"><span>{t("commonOptional")}</span><span>{issue.notes.length}/4000</span></span>
        </label>
      </div>
      {completeness.missing.length ? (
        <Notice title={t("diagnosisMissingMore", { items: translateMissing(completeness.missing) })} tone="warning">{t("diagnosisMissingImpact")}</Notice>
      ) : (
        <Notice title={t("diagnosisEvidenceReady")} tone="success">{t("diagnosisEvidenceReadyDetail")}</Notice>
      )}
    </div>
  )
}

function ElementsPanel({ targets }: { targets: SelectedTarget[] }) {
  if (!targets.length) return <EmptyEvidence icon={Box} title={t("diagnosisNoTargets")}>{t("diagnosisNoTargetsDetail")}</EmptyEvidence>
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow={t("diagnosisDomEyebrow")} title={t("diagnosisDomTitle", { count: targets.length })}>{t("diagnosisDomIntro")}</PanelIntro>
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
            [t("diagnosisActualResult"), target.annotation.actualResult],
            [t("diagnosisExpected"), target.annotation.expectedResult],
          ]} />
        ) : null}
        <DefinitionGrid items={[
          ["Selector", target.selector],
          ["XPath", target.xpath],
          [t("diagnosisAncestorPath"), target.ancestorPath],
          [t("diagnosisPosition"), `${target.rect.x}, ${target.rect.y} · ${target.rect.width} × ${target.rect.height}`],
          ["Role", target.role ?? t("commonNotSet")],
          ["data-testid", target.testId ?? t("commonNotSet")],
        ]} />
        <EvidenceBlock title={t("diagnosisDomSummary")} value={target.dom} />
        <EvidenceBlock title={t("diagnosisComputedStyle")} value={JSON.stringify(target.computedStyle, null, 2)} />
        {target.beforeStyle ? <EvidenceBlock title={t("diagnosisBeforeStyle")} value={JSON.stringify(target.beforeStyle, null, 2)} /> : null}
        {target.afterStyle ? <EvidenceBlock title={t("diagnosisAfterStyle")} value={JSON.stringify(target.afterStyle, null, 2)} /> : null}
        <div className="subsection">
          <h3>{t("diagnosisReactHint")}</h3>
          {target.react?.available ? (
            <DefinitionGrid items={[
              [t("diagnosisComponentChain"), target.react.componentChain.join(" > ") || t("diagnosisComponentUnknown")],
              ["Props Keys", target.react.propsKeys.join(", ") || t("diagnosisPropsNone")],
            ]} />
          ) : <p className="rl-muted m-0">{target.react?.boundary ? localizeKnownCopy(target.react.boundary) : t("diagnosisNoReact")}</p>}
        </div>
        <div className="subsection">
          <h3>{t("diagnosisCssRules")}</h3>
          {target.cssRules.length ? target.cssRules.map((rule, ruleIndex) => (
            <EvidenceBlock key={`${rule.selector}-${ruleIndex}`} title={`${rule.selector}${rule.styleSheetUrl ? ` · ${rule.styleSheetUrl}` : ""}`} value={rule.cssText} />
          )) : <p className="rl-muted m-0">{t("diagnosisNoCss")}</p>}
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
      <PanelIntro eyebrow="Console" title={t("diagnosisConsoleTitle", { count: events.length })}>{t("diagnosisConsoleIntro")}</PanelIntro>
      <EvidenceFilters query={query} setQuery={setQuery}>
        <SegmentedControl label={t("diagnosisLogLevel")} onChange={(value) => setLevel(value as typeof level)} options={[
          ["all", t("diagnosisAll")], ["error", t("diagnosisLevelError")], ["warn", t("diagnosisLevelWarn")], ["info", t("diagnosisLevelInfo")],
        ]} value={level} />
      </EvidenceFilters>
      {filtered.length ? <div className="evidence-list">{filtered.map((item) => <ConsoleItem item={item} key={item.id} />)}</div>
        : <EmptyEvidence icon={TerminalSquare} title={t("diagnosisNoConsole")}>{t("diagnosisAdjustFilters")}</EmptyEvidence>}
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
        <EvidenceBlock title={t("diagnosisMessage")} value={item.message} />
        {item.stack ? <EvidenceBlock title={t("diagnosisStack")} value={item.stack} /> : null}
        {item.truncated ? <p className="truncated-note">{t("diagnosisTruncated4k")}</p> : null}
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
      <PanelIntro eyebrow="Network" title={t("diagnosisNetworkTitle", { count: events.length })}>{t("diagnosisNetworkIntro")}</PanelIntro>
      <EvidenceFilters query={query} setQuery={setQuery}>
        <SegmentedControl label={t("diagnosisRequestType")} onChange={(value) => setType(value as typeof type)} options={[
          ["all", t("diagnosisAll")], ["fetch", "Fetch"], ["xhr", "XHR"], ["resource", t("diagnosisResource")],
        ]} value={type} />
      </EvidenceFilters>
      {filtered.length ? <div className="evidence-list">{filtered.map((item) => <NetworkItem item={item} key={item.id} />)}</div>
        : <EmptyEvidence icon={Network} title={t("diagnosisNoNetwork")}>{t("diagnosisAdjustFilters")}</EmptyEvidence>}
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
        {item.requestHeaders ? <EvidenceBlock title={t("diagnosisRequestHeaders")} value={JSON.stringify(item.requestHeaders, null, 2)} /> : null}
        {item.requestBody ? <EvidenceBlock title={t("diagnosisRequestBody", { suffix: item.requestBodyTruncated ? t("diagnosisTruncatedSuffix") : "" })} value={item.requestBody} /> : null}
        {item.responseHeaders ? <EvidenceBlock title={t("diagnosisResponseHeaders")} value={JSON.stringify(item.responseHeaders, null, 2)} /> : null}
        {item.responseBody ? <EvidenceBlock title={t("diagnosisResponseBody", { suffix: item.responseBodyTruncated ? t("diagnosisTruncatedSuffix") : "" })} value={item.responseBody} /> : null}
        {!item.requestBody && !item.responseBody && !item.requestHeaders && !item.responseHeaders ? <p className="rl-muted m-0">{t("diagnosisNoBody")}</p> : null}
      </div>
    </details>
  )
}

function EnvironmentPanel({ session }: { session: RootlineSession }) {
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow={t("diagnosisEnvEyebrow")} title={t("diagnosisEnvTitle")}>{t("diagnosisEnvIntro")}</PanelIntro>
      <section className="environment-section">
        <h3><Globe2 aria-hidden="true" size={17} />{t("diagnosisPage")}</h3>
        <DefinitionGrid items={[
          [t("diagnosisUrl"), session.page.url], [t("diagnosisPageTitle"), session.page.title], ["Origin", session.page.origin],
          [t("diagnosisViewport"), `${session.page.viewport.width} × ${session.page.viewport.height}`],
          ["DPR", String(session.page.viewport.devicePixelRatio)], [t("diagnosisLanguage"), session.page.language || t("commonUnknown")],
          [t("diagnosisStarted"), displayTime(session.startedAt)], [t("diagnosisCapturedAt"), session.screenshot.capturedAt ? displayTime(session.screenshot.capturedAt) : t("diagnosisNotCaptured")],
        ]} />
      </section>
      <section className="environment-section">
        <h3><Monitor aria-hidden="true" size={17} />{t("diagnosisBrowser")}</h3>
        <p className="user-agent rl-mono">{session.page.userAgent}</p>
      </section>
      <section className="environment-section">
        <h3><ShieldCheck aria-hidden="true" size={17} />{t("diagnosisGaps")}</h3>
        <ul className="boundary-list">
          {session.boundaries.map((boundary) => <li key={`${boundary.code}-${boundary.message}`}>{boundaryText(boundary)}</li>)}
          <li>{t("diagnosisDropped", { console: session.limits.consoleDropped, network: session.limits.networkDropped })}</li>
          <li>{t("diagnosisNotCollected")}</li>
        </ul>
      </section>
    </div>
  )
}

function AiPanel({ location, remoteLocation, markdown, onCopy }: { location: LocalArtifactLocation | undefined; remoteLocation: RemoteArtifactLocation | undefined; markdown: string; onCopy: () => Promise<void> }) {
  const [view, setView] = useState<"markdown" | "outline">("outline")
  return (
    <div className="panel-stack">
      <PanelIntro eyebrow={t("diagnosisAiEyebrow")} title={t("diagnosisAiTitle")}>{t("diagnosisAiIntro")}</PanelIntro>
      <div className="ai-toolbar">
        <SegmentedControl label={t("diagnosisContextView")} onChange={(value) => setView(value as typeof view)} options={[["outline", t("diagnosisOutline")], ["markdown", "Markdown"]]} value={view} />
        <button className="rl-button" onClick={() => void onCopy()} type="button"><Clipboard aria-hidden="true" size={17} />{t("diagnosisCopy")}</button>
      </div>
      {view === "outline" ? (
        <div className="context-outline">
          {[
            [t("diagnosisAiRole"), t("diagnosisAiRoleDetail")],
            ...(location ? [[t("diagnosisLocalFiles"), t("diagnosisLocalFilesDetail", { path: location.directoryPath })]] : []),
            ...(remoteLocation ? [[t("diagnosisRemoteLink"), remoteLocation.reportUrl]] : []),
            [t("diagnosisIssueGoal"), t("diagnosisIssueGoalDetail")],
            [t("diagnosisPageEnv"), t("diagnosisPageEnvDetail")],
            [t("diagnosisTargetsBlock"), t("diagnosisTargetsDetail")],
            [t("diagnosisConsoleNetwork"), t("diagnosisConsoleNetworkDetail")],
            [t("diagnosisOutputRules"), t("diagnosisOutputRulesDetail")],
          ].map(([title, description], index) => (
            <div key={title}><span>{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div></div>
          ))}
        </div>
      ) : <pre className="rl-code context-preview">{markdown}</pre>}
      <div className="format-row"><FileJson aria-hidden="true" size={17} /><span>{remoteLocation ? t("diagnosisRemoteCopyNote") : t("diagnosisLocalCopyNote")}</span></div>
    </div>
  )
}

function PanelIntro({ children, eyebrow, title }: { children: React.ReactNode; eyebrow: string; title: string }) {
  return <div className="panel-intro"><p>{eyebrow}</p><h2>{title}</h2><div>{children}</div></div>
}

function EvidenceFilters({ children, query, setQuery }: { children: React.ReactNode; query: string; setQuery: (value: string) => void }) {
  return (
    <div className="evidence-filters">
      <label className="search-field"><Search aria-hidden="true" size={16} /><span className="sr-only">{t("diagnosisSearchEvidence")}</span><input onChange={(event) => setQuery(event.target.value)} placeholder={t("diagnosisSearchPlaceholder")} type="search" value={query} /></label>
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
      <div><h3>{title}</h3><button aria-label={t("diagnosisCopyTitle", { title })} onClick={copy} title={t("diagnosisCopyTitle", { title })} type="button">{copied ? <Check aria-hidden="true" size={15} /> : <Clipboard aria-hidden="true" size={15} />}</button></div>
      <pre className="rl-code">{value}</pre>
    </section>
  )
}

function EmptyEvidence({ children, icon: Icon, title }: { children: React.ReactNode; icon: typeof Info; title: string }) {
  return <div className="empty-evidence"><Icon aria-hidden="true" size={24} /><h3>{title}</h3><p>{children}</p></div>
}
