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
import { Notice } from "../../components/Notice"
import type { ActiveState, ExtensionResponse } from "../../src/lib/messaging"
import type { RootlineSession } from "../../src/lib/types"
import { formatElapsedTime } from "../../src/lib/time"
import { DEFAULT_RECORDING_MAX_DURATION_MS } from "../../src/lib/recording-settings"

function hostLabel(value?: string): string {
  if (!value) return "未选择页面"
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? "Rootline 操作失败。")
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

export function PopupApp() {
  const [state, setState] = useState<ActiveState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const successTimer = useRef<number | null>(null)
  const sourceTabId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("sourceTabId")
    const parsed = value === null ? Number.NaN : Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
  }, [])

  const refresh = useCallback(async () => {
    try {
      const nextState = await request<ActiveState>({ type: "GET_ACTIVE_STATE", ...(sourceTabId !== undefined ? { tabId: sourceTabId } : {}) })
      setState(withCompatibleDefaults(nextState))
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法读取当前页面。")
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
      const message = nextError instanceof Error ? nextError.message : "Rootline 操作失败。"
      setError(message)
    } finally {
      setBusy(null)
    }
  }

  const openCosSettings = async () => {
    try {
      await chrome.windows.create({
        focused: true,
        height: 860,
        type: "popup",
        url: chrome.runtime.getURL("cos-settings.html"),
        width: 760,
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法打开腾讯云 COS 配置窗口。")
    }
  }

  const setSaveMode = (mode: "local" | "remote") => run(`mode:${mode}`, async () => {
    if (mode === "remote" && !state?.saveConfig?.remote) {
      await openCosSettings()
      return
    }
    await request({ type: "SET_SAVE_MODE", mode })
  })

  const start = (captureMode: "screenshot" | "video") => run(captureMode === "video" ? "record" : "start", async () => {
    if (typeof state?.tab?.id !== "number") throw new Error("无法确定当前标签页。")
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
    if (typeof state?.tab?.id !== "number") throw new Error("无法确定当前标签页。")
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
      setError(nextError instanceof Error ? nextError.message : "无法打开远程报告。")
    }
  }

  const copyRemoteReportLink = async () => {
    const reportUrl = state?.session?.remoteArtifacts?.reportUrl
    if (!reportUrl) return
    setError(null)
    try {
      await copyText(reportUrl)
      showSuccess("报告链接已复制，可直接粘贴到公司平台或浏览器打开。")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "报告链接复制失败。")
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
          <button aria-label="打开采集历史" className="rl-button rl-icon-button popup-help" onClick={() => void openHistory()} title="采集历史" type="button">
            <History aria-hidden="true" size={17} />
          </button>
          <button aria-label="打开使用说明" className="rl-button rl-icon-button popup-help" onClick={openInstructions} title="使用说明" type="button">
            <BookOpen aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <section aria-label="当前页面" className="rl-card page-summary">
        <div className="page-summary__top">
          <span className="rl-status-dot" data-status={state?.supported ? "active" : "error"} />
          <span className="rl-muted text-xs">{hostLabel(state?.tab?.url)}</span>
        </div>
        <p className="page-summary__title">{state?.tab?.title ?? "正在读取当前页面…"}</p>
        <p className="rl-mono rl-muted page-summary__url">{state?.tab?.url ?? ""}</p>
      </section>

      {error ? <Notice title={error} tone="error" /> : null}
      {success ? <Notice title={success} tone="success" /> : null}
      {!state?.supported && state?.unsupportedReason ? <Notice title="当前页面不可采集" tone="warning">{state.unsupportedReason}</Notice> : null}

      {state?.recording && state.recording.tabId !== state.tab?.id ? (
        <section className="recording-away">
          <div className="recording-away__status"><span className="capture-pulse" /><div><p>正在录制整个屏幕</p><span>{state.recording.pageTitle}</span></div><code>{formatElapsedTime(state.recording.startedAt)}</code></div>
          <button className="rl-button w-full" onClick={() => void returnToRecordingPage()} type="button"><ArrowUpRight aria-hidden="true" size={17} />返回来源页</button>
          <button className="rl-button rl-button--danger w-full" disabled={busy !== null} onClick={stopRecording} type="button"><CircleStop aria-hidden="true" size={17} />停止录屏</button>
        </section>
      ) : null}

      {state?.recording && state.recording.tabId !== state.tab?.id ? null : isCapturing && session ? (
        <section aria-label="采集进度" className="capture-state">
          <div className="capture-state__heading">
            <div className="flex items-center gap-2">
              <span className="capture-pulse" />
              <div>
                <p className="capture-state__title">{busy === "finish" ? "正在生成本次证据" : isRecording ? "正在录制整个屏幕" : isVideoCapture ? "录屏已停止" : "采集已开始"}</p>
                <p className="capture-state__detail">{busy === "finish" ? "正在隐藏工具条、整理证据并生成截图" : isRecording ? "复现问题时可以继续选择和标注元素" : isVideoCapture ? "回到来源页确认后生成完整证据" : "正在等待你复现问题"}</p>
              </div>
            </div>
            <span className="elapsed-time">已运行 {formatElapsedTime(session.startedAt)}</span>
          </div>
          <div className="evidence-grid">
            <EvidenceMetric label="目标元素" value={session.targets} />
            <EvidenceMetric label="控制台" value={session.consoleEvents} />
            <EvidenceMetric label="错误" value={session.errors} {...(session.errors ? { tone: "error" as const } : {})} />
            <EvidenceMetric label="网络请求" value={session.networkEvents} />
          </div>
          <p className="rl-muted m-0 text-xs leading-relaxed">采集没有固定等待时间。复现并标注完成后，即可结束并生成证据。</p>
          {isRecording ? (
            <button className="rl-button rl-button--danger w-full" disabled={busy !== null} onClick={stopRecording} type="button">
              {busy === "stop-recording" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <CircleStop aria-hidden="true" size={17} />}
              {busy === "stop-recording" ? "正在停止录屏" : "停止录屏"}
            </button>
          ) : null}
          <button className="rl-button w-full" disabled={busy !== null} onClick={resume} type="button">
            {busy === "resume" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Play aria-hidden="true" size={17} />}
            回到页面继续复现
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button className="rl-button rl-button--accent" disabled={busy !== null} onClick={finish} type="button">
              {busy === "finish" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <CircleStop aria-hidden="true" size={17} />}
              {busy === "finish" ? "正在生成证据" : "结束并生成证据"}
            </button>
            <button className="rl-button rl-button--danger" disabled={busy !== null} onClick={discard} type="button">
              <Trash2 aria-hidden="true" size={17} />
              放弃采集
            </button>
          </div>
        </section>
      ) : canReview ? (
        <section className="capture-state">
          <Notice title="本次证据已生成" tone="success">{session.remoteArtifacts ? "报告已上传到你的腾讯云 COS，可直接复制远程链接。" : "报告和标注截图已保存到本机，完整路径可在证据页查看。"}</Notice>
          <button className="rl-button rl-button--primary w-full" onClick={openReview} type="button">
            <ArrowUpRight aria-hidden="true" size={17} />
            查看本次完整证据
          </button>
          <button className="rl-button w-full" disabled={busy !== null} onClick={reannotate} type="button">
            {busy === "reannotate" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <RotateCcw aria-hidden="true" size={17} />}
            {busy === "reannotate" ? "正在连接页面" : "重新标注"}
          </button>
          {session.remoteArtifacts ? (
            <div className="remote-review-actions">
              <button className="rl-button rl-button--primary" disabled={busy !== null} onClick={() => void openRemoteReport()} type="button">
                <ExternalLink aria-hidden="true" size={17} />打开远程报告
              </button>
              <button className="rl-button" disabled={busy !== null} onClick={() => void copyRemoteReportLink()} type="button">
                <ClipboardCopy aria-hidden="true" size={17} />复制报告链接
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="capture-entry-actions">
            <button className="rl-button recording-start w-full" data-state={busy === "record" ? "loading" : undefined} disabled={!state?.supported || busy !== null} onClick={() => start("video")} type="button">
              {busy === "record" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Video aria-hidden="true" size={17} />}
              {busy === "record" ? "正在请求屏幕权限" : "录制页面"}
            </button>
            <button className="rl-button rl-button--primary w-full" data-state={busy === "start" ? "loading" : undefined} disabled={!state?.supported || busy !== null} onClick={() => start("screenshot")} type="button">
              {busy === "start" ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Camera aria-hidden="true" size={17} />}
              {busy === "start" ? "正在连接当前页面" : "开始标注"}
            </button>
          </div>
          <div className="workflow-line" aria-label="采集流程">
            <Activity aria-hidden="true" size={16} />
            <span>复现问题</span>
            <span aria-hidden="true">→</span>
            <span>选择元素</span>
            <span aria-hidden="true">→</span>
            <span>导出上下文</span>
          </div>
        </section>
      )}

      <footer className="popup-footer save-mode-footer">
        <div aria-label="证据保存模式" className="save-mode-tabs" role="tablist">
          <button aria-selected={(state?.saveConfig?.mode ?? "local") === "local"} disabled={isCapturing || busy !== null} onClick={() => void setSaveMode("local")} role="tab" type="button">
            <HardDrive aria-hidden="true" size={15} />本地
          </button>
          <button aria-selected={state?.saveConfig?.mode === "remote"} disabled={isCapturing || busy !== null} onClick={() => void setSaveMode("remote")} role="tab" type="button">
            <Cloud aria-hidden="true" size={15} />远程
          </button>
        </div>
        <button aria-label="配置腾讯云 COS" className="rl-button rl-icon-button save-settings" onClick={() => void openCosSettings()} title="远程保存设置" type="button">
          <Settings2 aria-hidden="true" size={16} />
        </button>
        <p>{state?.saveConfig?.mode === "remote" ? `腾讯云 COS · ${state.saveConfig.remote?.bucket ?? "未配置"}` : "文件保存到浏览器下载目录 / Rootline"}</p>
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
