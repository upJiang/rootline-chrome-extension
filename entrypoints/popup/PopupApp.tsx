import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Camera,
  CircleStop,
  ClipboardCopy,
  Cloud,
  ExternalLink,
  HardDrive,
  History,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings2,
  Trash2,
  Video,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brand } from "../../components/Brand"
import { LocaleToggle, useI18n } from "../../components/LocaleToggle"
import { Notice } from "../../components/Notice"
import { providerName, t } from "../../src/lib/i18n"
import type { ActiveState, ExtensionResponse } from "../../src/lib/messaging"
import type { RootlineSession } from "../../src/lib/types"
import { formatElapsedTime } from "../../src/lib/time"
import { DEFAULT_RECORDING_MAX_DURATION_MS } from "../../src/lib/recording-settings"

const REMOTE_SETTINGS_WINDOW_WIDTH = 700
const REMOTE_SETTINGS_WINDOW_HEIGHT = 760
const REMOTE_SETTINGS_TOOLBAR_OFFSET = 84
const REMOTE_SETTINGS_EDGE_GAP = 14

function hostLabel(value?: string): string {
  if (!value) return t("popupNoPage")
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? t("commonOperationFailed"))
  return response.data as T
}

function withCompatibleDefaults(value: ActiveState): ActiveState {
  return {
    ...value,
    recording: value.recording ?? null,
  }
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

async function remoteSettingsWindowPosition(): Promise<{ left?: number; top?: number }> {
  const currentWindow = await chrome.windows.getCurrent().catch(() => null)
  const left = currentWindow?.left
  const top = currentWindow?.top
  const width = currentWindow?.width
  if (typeof left !== "number" || typeof top !== "number" || typeof width !== "number") return {}
  return {
    left: Math.round(Math.max(
      left + REMOTE_SETTINGS_EDGE_GAP,
      left + width - REMOTE_SETTINGS_WINDOW_WIDTH - REMOTE_SETTINGS_EDGE_GAP,
    )),
    top: Math.round(top + REMOTE_SETTINGS_TOOLBAR_OFFSET),
  }
}

export function PopupApp() {
  const { locale } = useI18n()
  const [state, setState] = useState<ActiveState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const successTimer = useRef<number | null>(null)
  const windowParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const sourceTabId = useMemo(() => {
    const value = windowParams.get("sourceTabId")
    const parsed = value === null ? Number.NaN : Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
  }, [windowParams])

  const refresh = useCallback(async () => {
    try {
      const nextState = await request<ActiveState>({ type: "GET_ACTIVE_STATE", ...(sourceTabId !== undefined ? { tabId: sourceTabId } : {}) })
      setState(withCompatibleDefaults(nextState))
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("popupReadFailed"))
    }
  }, [sourceTabId])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 1_000)
    return () => {
      window.clearInterval(interval)
      if (successTimer.current !== null) window.clearTimeout(successTimer.current)
    }
  }, [refresh])

  useEffect(() => {
    document.title = t("popupDocumentTitle")
  }, [locale])

  const showSuccess = (message: string) => {
    if (successTimer.current !== null) window.clearTimeout(successTimer.current)
    setSuccess(message)
    successTimer.current = window.setTimeout(() => {
      setSuccess(null)
      successTimer.current = null
    }, 3_000)
  }

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : t("commonOperationFailed")
      setError(message)
    } finally {
      setBusy(null)
    }
  }

  const openCosSettingsWindow = async () => {
    try {
      // Chrome does not expose the toolbar icon's exact screen coordinates.
      // Anchor the new popup to the current browser's top-right edge without
      // updating or moving the source browser window.
      const position = await remoteSettingsWindowPosition()
      const created = await chrome.windows.create({
        focused: true,
        height: REMOTE_SETTINGS_WINDOW_HEIGHT,
        ...position,
        type: "popup",
        url: chrome.runtime.getURL("cos-settings.html"),
        width: REMOTE_SETTINGS_WINDOW_WIDTH,
      })
      if (created.id === undefined) return
      // Closing the action popup is expected once the child receives focus;
      // this does not affect the capture overlay running in the source tab.
      window.close()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("popupOpenSettingsFailed"))
    }
  }

  const openCosSettings = openCosSettingsWindow

  const setSaveMode = (mode: "local" | "remote") => run(`mode:${mode}`, async () => {
    if (mode === "remote" && !(state?.saveConfig?.provider === "aliyun-oss" ? state.saveConfig.aliyunOss : state?.saveConfig?.tencentCos ?? state?.saveConfig?.remote)) {
      await openCosSettings()
      return
    }
    await request({ type: "SET_SAVE_MODE", mode })
  })

  const start = (captureMode: "screenshot" | "video") => run(captureMode === "video" ? "record" : "start", async () => {
    if (typeof state?.tab?.id !== "number") throw new Error(t("popupUnknownTab"))
    const session = await request<RootlineSession>({
      type: "START_SESSION",
      tabId: state.tab.id,
      captureMode,
      ...(captureMode === "video" ? { maxDurationMs: DEFAULT_RECORDING_MAX_DURATION_MS } : {}),
    })
    if (["reviewing", "exported"].includes(session.status)) await openSessionReport(session)
    window.close()
  })

  const finish = () => run("finish", async () => {
    if (!state?.session) return
    await request({ type: "FINISH_SESSION", sessionId: state.session.id })
    window.close()
  })

  const resume = () => run("resume", async () => {
    if (typeof state?.tab?.id !== "number") throw new Error(t("popupUnknownTab"))
    await request<RootlineSession>({ type: "START_SESSION", tabId: state.tab.id })
    window.close()
  })

  const discard = () => run("discard", async () => {
    if (!state?.session) return
    await request({ type: "DISCARD_SESSION", sessionId: state.session.id })
  })

  const stopRecording = () => run("stop-recording", async () => {
    const sessionId = state?.recording?.sessionId ?? state?.session?.id
    if (!sessionId) return
    await request({ type: "STOP_RECORDING", sessionId })
    window.close()
  })

  const returnToRecordingPage = async () => {
    if (!state?.recording) return
    await chrome.tabs.update(state.recording.tabId, { active: true })
    window.close()
  }

  const reannotate = () => run("reannotate", async () => {
    if (!state?.session) return
    await request<RootlineSession>({ type: "REANNOTATE_SESSION", sessionId: state.session.id })
    window.close()
  })

  const openRemoteReport = async () => {
    const reportUrl = state?.session?.remoteArtifacts?.reportUrl
    if (!reportUrl) return
    setError(null)
    try {
      await chrome.tabs.create({ url: reportUrl })
      window.close()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("popupOpenRemoteFailed"))
    }
  }

  const copyRemoteReportLink = async () => {
    const reportUrl = state?.session?.remoteArtifacts?.reportUrl
    if (!reportUrl) return
    setError(null)
    try {
      await copyText(reportUrl)
      showSuccess(t("popupLinkCopied"))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("popupLinkCopyFailed"))
    }
  }

  const openReview = async () => {
    if (!state?.session) return
    // Remote captures are already self-contained report.html artifacts. Open
    // the COS URL directly so a missing browser history cache cannot turn a
    // successful upload into a misleading red error page.
    if (state.session.remoteArtifacts?.reportUrl) {
      await chrome.tabs.create({ url: state.session.remoteArtifacts.reportUrl })
      window.close()
      return
    }
    const remoteRecord = state.session.remoteArtifacts?.objectPrefix.split("/").filter(Boolean).at(-1)
    const record = state.session.localArtifacts?.directoryName ?? remoteRecord
    const url = record
      ? `capture.html?record=${encodeURIComponent(record)}`
      : `capture.html?session=${encodeURIComponent(state.session.id)}`
    await chrome.tabs.create({ url: chrome.runtime.getURL(url) })
    window.close()
  }

  const openInstructions = async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("instructions.html") })
    window.close()
  }

  const openHistory = async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("capture-history.html") })
    window.close()
  }

  const session = state?.session
  const isCapturing = session?.status === "capturing"
  const isVideoCapture = session?.captureMode === "video"
  const isRecording = session?.recordingState?.status === "recording"
  const canReview = session && ["reviewing", "exported"].includes(session.status)

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <Brand />
        <div className="popup-header__actions">
          <LocaleToggle />
          <button aria-label={t("popupOpenHistory")} className="rl-button rl-icon-button popup-help" onClick={() => void openHistory()} title={t("popupHistoryTitle")} type="button">
            <History aria-hidden="true" size={17} />
          </button>
          <button aria-label={t("popupOpenInstructions")} className="rl-button rl-icon-button popup-help" onClick={openInstructions} title={t("popupInstructionsTitle")} type="button">
            <BookOpen aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <section aria-label={t("popupCurrentPage")} className="rl-card page-summary">
        <div className="page-summary__top">
          <span className="rl-status-dot" data-status={state?.supported ? "active" : "error"} />
          <span className="rl-muted text-xs">{hostLabel(state?.tab?.url)}</span>
        </div>
        <p className="page-summary__title">{state?.tab?.title ?? t("popupReadingPage")}</p>
        <p className="rl-mono rl-muted page-summary__url">{state?.tab?.url ?? ""}</p>
      </section>

      {error ? <Notice title={error} tone="error" /> : null}
      {success ? <Notice title={success} tone="success" /> : null}
      {!state?.supported && state?.unsupportedReason ? <Notice title={t("popupUnsupported")} tone="warning">{state.unsupportedReason}</Notice> : null}

      {state?.recording && state.recording.tabId !== state.tab?.id ? (
        <section className="recording-away">
          <div className="recording-away__status"><span className="capture-pulse" /><div><p>{t("popupRecordingScreen")}</p><span>{state.recording.pageTitle}</span></div><code>{formatElapsedTime(state.recording.startedAt)}</code></div>
          <button className="rl-button w-full" onClick={() => void returnToRecordingPage()} type="button"><ArrowUpRight aria-hidden="true" size={17} />{t("popupReturnToSource")}</button>
          <button className="rl-button rl-button--danger w-full" disabled={busy !== null} onClick={stopRecording} type="button"><CircleStop aria-hidden="true" size={17} />{t("popupStopRecording")}</button>
        </section>
      ) : null}

      {state?.recording && state.recording.tabId !== state.tab?.id ? null : isCapturing && session ? (
        <section aria-label={t("popupCaptureProgress")} className="capture-state">
          <div className="capture-state__heading">
            <div className="flex items-center gap-2">
              <span className="capture-pulse" />
              <div>
                <p className="capture-state__title">{busy === "finish" ? t("popupGeneratingEvidence") : isRecording ? t("popupRecordingScreen") : isVideoCapture ? t("popupRecordingStopped") : t("popupCaptureStarted")}</p>
                <p className="capture-state__detail">{busy === "finish" ? t("popupGeneratingDetail") : isRecording ? t("popupRecordingDetail") : isVideoCapture ? t("popupRecordingStoppedDetail") : t("popupWaitingDetail")}</p>
              </div>
            </div>
            <span className="elapsed-time">{t("popupElapsed", { time: formatElapsedTime(session.startedAt) })}</span>
          </div>
          <div className="evidence-grid">
            <EvidenceMetric label={t("popupMetricTargets")} value={session.targets} />
            <EvidenceMetric label={t("popupMetricConsole")} value={session.consoleEvents} />
            <EvidenceMetric label={t("popupMetricErrors")} value={session.errors} {...(session.errors ? { tone: "error" as const } : {})} />
            <EvidenceMetric label={t("popupMetricNetwork")} value={session.networkEvents} />
          </div>
          <p className="rl-muted m-0 text-xs leading-relaxed">{t("popupNoFixedWait")}</p>
          {isRecording ? (
            <button className="rl-button rl-button--danger w-full" disabled={busy !== null} onClick={stopRecording} type="button">
              {busy === "stop-recording" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <CircleStop aria-hidden="true" size={17} />}
              {busy === "stop-recording" ? t("popupStoppingRecording") : t("popupStopRecording")}
            </button>
          ) : null}
          <button className="rl-button w-full" disabled={busy !== null} onClick={resume} type="button">
            {busy === "resume" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Play aria-hidden="true" size={17} />}
            {t("popupBackToPage")}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button className="rl-button rl-button--accent" disabled={busy !== null} onClick={finish} type="button">
              {busy === "finish" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <CircleStop aria-hidden="true" size={17} />}
              {busy === "finish" ? t("popupFinishing") : t("popupFinish")}
            </button>
            <button className="rl-button rl-button--danger" disabled={busy !== null} onClick={discard} type="button">
              <Trash2 aria-hidden="true" size={17} />
              {t("popupDiscard")}
            </button>
          </div>
        </section>
      ) : canReview ? (
        <section className="capture-state">
          <Notice title={t("popupEvidenceReady")} tone="success">{session.remoteArtifacts ? t("popupRemoteReady", { provider: providerName(session.remoteArtifacts.provider) }) : t("popupLocalReady")}</Notice>
          <button className="rl-button rl-button--primary w-full" onClick={openReview} type="button">
            <ArrowUpRight aria-hidden="true" size={17} />
            {t("popupViewEvidence")}
          </button>
          <button className="rl-button w-full" disabled={busy !== null} onClick={reannotate} type="button">
            {busy === "reannotate" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <RotateCcw aria-hidden="true" size={17} />}
            {busy === "reannotate" ? t("popupConnecting") : t("popupReannotate")}
          </button>
          {session.remoteArtifacts ? (
            <div className="remote-review-actions">
              <button className="rl-button rl-button--primary" disabled={busy !== null} onClick={() => void openRemoteReport()} type="button">
                <ExternalLink aria-hidden="true" size={17} />{t("popupOpenRemote")}
              </button>
              <button className="rl-button" disabled={busy !== null} onClick={() => void copyRemoteReportLink()} type="button">
                <ClipboardCopy aria-hidden="true" size={17} />{t("popupCopyLink")}
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="capture-entry-actions">
            <button className="rl-button recording-start w-full" data-state={busy === "record" ? "loading" : undefined} disabled={!state?.supported || busy !== null} onClick={() => start("video")} type="button">
              {busy === "record" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Video aria-hidden="true" size={17} />}
              {busy === "record" ? t("popupRequestingScreen") : t("popupRecordPage")}
            </button>
            <button className="rl-button rl-button--primary w-full" data-state={busy === "start" ? "loading" : undefined} disabled={!state?.supported || busy !== null} onClick={() => start("screenshot")} type="button">
              {busy === "start" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Camera aria-hidden="true" size={17} />}
              {busy === "start" ? t("popupConnectingPage") : t("popupStartAnnotate")}
            </button>
          </div>
          <div className="workflow-line" aria-label={t("popupWorkflow")}>
            <Activity aria-hidden="true" size={16} />
            <span>{t("popupReproduce")}</span>
            <span aria-hidden="true">→</span>
            <span>{t("popupSelectElements")}</span>
            <span aria-hidden="true">→</span>
            <span>{t("popupExportContext")}</span>
          </div>
        </section>
      )}

      <footer className="popup-footer save-mode-footer">
        <div aria-label={t("popupSaveMode")} className="save-mode-tabs" role="tablist">
          <button aria-selected={(state?.saveConfig?.mode ?? "local") === "local"} disabled={isCapturing || busy !== null} onClick={() => void setSaveMode("local")} role="tab" type="button">
            <HardDrive aria-hidden="true" size={15} />{t("popupLocal")}
          </button>
          <button aria-selected={state?.saveConfig?.mode === "remote"} disabled={isCapturing || busy !== null} onClick={() => void setSaveMode("remote")} role="tab" type="button">
            <Cloud aria-hidden="true" size={15} />{t("popupRemote")}
          </button>
        </div>
        <button aria-label={t("popupConfigureRemote")} className="rl-button rl-icon-button save-settings" onClick={() => void openCosSettings()} title={t("popupRemoteSettings")} type="button">
          <Settings2 aria-hidden="true" size={16} />
        </button>
        <p>{state?.saveConfig?.mode === "remote" ? t("popupRemoteFooter", { provider: providerName(state.saveConfig.provider), bucket: (state.saveConfig.provider === "aliyun-oss" ? state.saveConfig.aliyunOss?.bucket : state.saveConfig.tencentCos?.bucket ?? state.saveConfig.remote?.bucket) ?? t("commonUnconfigured") }) : t("popupLocalFooter")}</p>
      </footer>
    </main>
  )
}

async function openSessionReport(session: RootlineSession): Promise<void> {
  const remoteRecord = session.remoteArtifacts?.objectPrefix.split("/").filter(Boolean).at(-1)
  const record = session.localArtifacts?.directoryName ?? remoteRecord
  const url = record
    ? `capture.html?record=${encodeURIComponent(record)}`
    : `capture.html?session=${encodeURIComponent(session.id)}`
  await chrome.tabs.create({ url: chrome.runtime.getURL(url) })
}

function EvidenceMetric({ label, tone, value }: { label: string; tone?: "error"; value: number }) {
  return (
    <div className="evidence-metric" data-tone={tone}>
      <span className="evidence-metric__value">{value}</span>
      <span className="rl-muted text-xs">{label}</span>
    </div>
  )
}
