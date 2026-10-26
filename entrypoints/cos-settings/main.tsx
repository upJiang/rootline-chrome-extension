import "@fontsource/nunito/400.css"
import "@fontsource/nunito/600.css"
import "@fontsource/nunito/700.css"
import "@fontsource/fira-code/400.css"
import React, { Component, type ErrorInfo, type ReactNode } from "react"
import ReactDOM, { type Root } from "react-dom/client"
import { X } from "lucide-react"
import { Brand } from "../../components/Brand"
import { LocaleProvider, LocaleToggle, useI18n } from "../../components/LocaleToggle"
import { Notice } from "../../components/Notice"
import { localizeKnownCopy, providerName, t } from "../../src/lib/i18n"
import type { ExtensionResponse } from "../../src/lib/messaging"
import type { CaptureSaveConfig } from "../../src/lib/remote-config"
import type { AliyunOssConfig, RemoteProvider, RemoteStorageConfig, TencentCosConfig } from "../../src/lib/types"
import "../../styles/globals.css"
import "../../styles/components.css"
import "./style.css"

type Feedback = { tone: "success" | "error"; message: string }
type FormState = { bucket: string; region: string; secretId: string; secretKey: string; accessKeyId: string; accessKeySecret: string; objectPrefix: string; publicBaseUrl: string; configuredAt: string; verifiedAt: string }

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? t("commonOperationFailed"))
  return response.data as T
}

function initialForm(provider: RemoteProvider, config?: TencentCosConfig | AliyunOssConfig): FormState {
  if (provider === "aliyun-oss") {
    const value = config?.provider === "aliyun-oss" ? config : undefined
    return { bucket: value?.bucket ?? "", region: value?.region.replace(/^oss-/, "") ?? "cn-guangzhou", secretId: "", secretKey: "", accessKeyId: value?.accessKeyId ?? "", accessKeySecret: value?.accessKeySecret ?? "", objectPrefix: value?.objectPrefix ?? "rootline/", publicBaseUrl: value?.publicBaseUrl ?? "", configuredAt: value?.configuredAt ?? "", verifiedAt: value?.verifiedAt ?? "" }
  }
  const value = config?.provider === "tencent-cos" ? config : undefined
  return { bucket: value?.bucket ?? "", region: value?.region ?? "ap-guangzhou", secretId: value?.secretId ?? "", secretKey: value?.secretKey ?? "", accessKeyId: "", accessKeySecret: "", objectPrefix: value?.objectPrefix ?? "rootline/", publicBaseUrl: value?.publicBaseUrl ?? "", configuredAt: value?.configuredAt ?? "", verifiedAt: value?.verifiedAt ?? "" }
}

export function CosSettingsApp() {
  const { locale } = useI18n()
  const [saveConfig, setSaveConfig] = React.useState<CaptureSaveConfig | null>(null)
  const [provider, setProvider] = React.useState<RemoteProvider>("tencent-cos")
  const [form, setForm] = React.useState<FormState>(() => initialForm("tencent-cos"))
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const feedbackTimer = React.useRef<number | null>(null)

  React.useEffect(() => {
    // Chrome may initially reuse the host work-area bounds while the popup
    // page is loading. Re-apply only compact dimensions after mount; never
    // set left/top so the source page and capture overlay cannot move.
    void chrome.windows.getCurrent().then((currentWindow) => {
      if (currentWindow.id === undefined) return
      return chrome.windows.update(currentWindow.id, { focused: true, height: 760, width: 700 })
    }).catch(() => undefined)
  }, [])

  React.useEffect(() => {
    document.title = t("settingsDocumentTitle")
  }, [locale])

  const showFeedback = React.useCallback((next: Feedback) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    setFeedback(next)
    feedbackTimer.current = next.tone === "success" ? window.setTimeout(() => { setFeedback(null); feedbackTimer.current = null }, 3_000) : null
  }, [])

  const refresh = React.useCallback(async () => {
    const next = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" })
    setSaveConfig(next)
    const nextProvider = next.provider ?? "tencent-cos"
    setProvider(nextProvider)
    setForm(initialForm(nextProvider, nextProvider === "aliyun-oss" ? next.aliyunOss : next.tencentCos ?? next.remote))
  }, [])

  React.useEffect(() => { void refresh().catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("settingsReadFailed") })).finally(() => setLoading(false)) }, [refresh, showFeedback])
  React.useEffect(() => () => { if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current) }, [])

  const selectProvider = (nextProvider: RemoteProvider) => {
    if (nextProvider === provider) return
    setProvider(nextProvider)
    setFeedback(null)
    setForm(initialForm(nextProvider, nextProvider === "aliyun-oss" ? saveConfig?.aliyunOss : saveConfig?.tencentCos ?? saveConfig?.remote))
  }

  const configFromForm = (): RemoteStorageConfig => provider === "aliyun-oss"
    ? { provider, bucket: form.bucket, region: form.region, accessKeyId: form.accessKeyId, accessKeySecret: form.accessKeySecret, objectPrefix: form.objectPrefix, ...(form.publicBaseUrl.trim() ? { publicBaseUrl: form.publicBaseUrl } : {}), configuredAt: form.configuredAt || new Date().toISOString(), ...(form.verifiedAt ? { verifiedAt: form.verifiedAt } : {}) } satisfies AliyunOssConfig
    : { provider, bucket: form.bucket, region: form.region, secretId: form.secretId, secretKey: form.secretKey, objectPrefix: form.objectPrefix, ...(form.publicBaseUrl.trim() ? { publicBaseUrl: form.publicBaseUrl } : {}), configuredAt: form.configuredAt || new Date().toISOString(), ...(form.verifiedAt ? { verifiedAt: form.verifiedAt } : {}) } satisfies TencentCosConfig

  const updateField = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value, ...(field !== "verifiedAt" ? { verifiedAt: "" } : {}) }))
  const run = async (label: string, operation: () => Promise<void>) => { setBusy(label); setFeedback(null); try { await operation() } catch (error: unknown) { showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("commonOperationFailed") }) } finally { setBusy(null) } }

  const save = () => run("save", async () => {
    const saved = await request<CaptureSaveConfig>({ type: "SAVE_REMOTE_CONFIG", config: configFromForm() })
    setSaveConfig(saved)
    setForm(initialForm(provider, provider === "aliyun-oss" ? saved.aliyunOss : saved.tencentCos ?? saved.remote))
    showFeedback({ tone: "success", message: t("settingsSaved", { provider: providerName(provider) }) })
  })
  const test = () => run("test", async () => {
    const verified = await request<RemoteStorageConfig>({ type: "TEST_REMOTE_CONFIG", config: configFromForm() })
    const saved = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" })
    setSaveConfig(saved)
    setForm(initialForm(provider, verified))
    showFeedback({ tone: "success", message: t("settingsTested", { provider: providerName(provider) }) })
  })
  const clear = () => run("clear", async () => {
    const next = await request<CaptureSaveConfig>({ type: "CLEAR_REMOTE_CONFIG", provider })
    setSaveConfig(next)
    setForm(initialForm(provider))
    showFeedback({ tone: "success", message: t("settingsCleared", { provider: providerName(provider) }) })
  })
  const useLocal = () => run("local", async () => { await request({ type: "SET_SAVE_MODE", mode: "local" }); const next = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" }); setSaveConfig(next); showFeedback({ tone: "success", message: t("settingsUseLocalDone") }) })

  if (loading) return <main className="cos-settings-shell cos-settings-loading">{t("settingsLoading")}</main>
  const currentConfig = provider === "aliyun-oss" ? saveConfig?.aliyunOss : saveConfig?.tencentCos ?? saveConfig?.remote

  return <main className="cos-settings-shell">
    <header className="cos-settings-header"><Brand /><div className="flex items-center gap-3"><span className="rl-muted text-xs">{t("settingsHeading")}</span><LocaleToggle /><button aria-label={t("settingsClose")} className="rl-button rl-icon-button" onClick={() => window.close()} title={t("settingsCloseTitle")} type="button"><X aria-hidden="true" size={17} /></button></div></header>
    <section className="cos-settings-intro"><p className="cos-settings-eyebrow">{t("settingsEyebrow")}</p><h1>{t("settingsChooseProvider")}</h1><p>{t("settingsIntro")}</p></section>
    {feedback ? <Notice title={localizeKnownCopy(feedback.message)} tone={feedback.tone} /> : null}
    <div aria-label={t("settingsProviders")} className="provider-tabs" role="tablist"><button aria-selected={provider === "tencent-cos"} onClick={() => selectProvider("tencent-cos")} role="tab" type="button">{t("providerTencent")}</button><button aria-selected={provider === "aliyun-oss"} onClick={() => selectProvider("aliyun-oss")} role="tab" type="button">{t("providerAliyun")}</button></div>
    <section className="cos-settings-card" aria-labelledby="permission-title"><div className="cos-settings-permission-icon" aria-hidden="true">!</div><div><h2 id="permission-title">{t("settingsPermissionTitle", { permission: provider === "aliyun-oss" ? t("settingsPermissionAliyun") : t("settingsPermissionPublicRead") })}</h2><p>{t("settingsPermissionDetail")}</p></div></section>
    <section className="cos-settings-card cos-settings-form-card" aria-labelledby="form-title"><div className="cos-settings-section-heading"><div><p className="cos-settings-eyebrow">{t("settingsCredentials")}</p><h2 id="form-title">{t("settingsProviderInfo", { provider: providerName(provider) })}</h2></div><span>{currentConfig ? t("settingsConfigured") : t("settingsNotConfigured")}</span></div><div className="cos-settings-form"><label><span>Bucket</span><input aria-label="Bucket" className="rl-field" onChange={(event) => updateField("bucket", event.target.value)} placeholder={provider === "aliyun-oss" ? "rootline-evidence" : "rootline-1250000000"} value={form.bucket} /></label><label><span>Region</span><input aria-label="Region" className="rl-field" onChange={(event) => updateField("region", event.target.value)} placeholder={provider === "aliyun-oss" ? "cn-guangzhou" : "ap-guangzhou"} value={form.region} /></label>{provider === "aliyun-oss" ? <><label><span>AccessKey ID</span><input aria-label="AccessKey ID" autoComplete="off" className="rl-field" onChange={(event) => updateField("accessKeyId", event.target.value)} placeholder={t("settingsAliyunIdPlaceholder")} value={form.accessKeyId} /></label><label><span>AccessKey Secret</span><input aria-label="AccessKey Secret" autoComplete="new-password" className="rl-field" onChange={(event) => updateField("accessKeySecret", event.target.value)} placeholder={t("settingsAliyunSecretPlaceholder")} type="password" value={form.accessKeySecret} /></label></> : <><label><span>SecretId</span><input aria-label="SecretId" autoComplete="off" className="rl-field" onChange={(event) => updateField("secretId", event.target.value)} placeholder={t("settingsTencentIdPlaceholder")} value={form.secretId} /></label><label><span>SecretKey</span><input aria-label="SecretKey" autoComplete="new-password" className="rl-field" onChange={(event) => updateField("secretKey", event.target.value)} placeholder={t("settingsTencentKeyPlaceholder")} type="password" value={form.secretKey} /></label></>}<label><span>{t("settingsObjectPrefix")}</span><input aria-label={t("settingsObjectPrefix")} className="rl-field" onChange={(event) => updateField("objectPrefix", event.target.value)} placeholder="rootline/" value={form.objectPrefix} /></label><label><span>{t("settingsCustomDomain")}</span><input aria-label={t("settingsCustomDomainAria")} className="rl-field" onChange={(event) => updateField("publicBaseUrl", event.target.value)} placeholder="https://evidence.example.com" value={form.publicBaseUrl} /></label></div></section>
    {provider === "aliyun-oss" ? <AliyunGuide /> : <TencentGuide />}
    <p className="cos-settings-privacy">{t("settingsPrivacy")}</p>
    <footer className="cos-settings-actions"><button className="rl-button" disabled={busy !== null} onClick={() => void useLocal()} type="button">{t("settingsUseLocal")}</button><span className="cos-settings-actions__spacer" />{currentConfig ? <button className="rl-button rl-button--danger" disabled={busy !== null} onClick={() => void clear()} type="button">{t("settingsClear")}</button> : null}<button className="rl-button" data-state={busy === "test" ? "loading" : undefined} disabled={busy !== null} onClick={() => void test()} type="button">{busy === "test" ? t("settingsTesting") : t("settingsTest")}</button><button className="rl-button rl-button--primary" data-state={busy === "save" ? "loading" : undefined} disabled={busy !== null} onClick={() => void save()} type="button">{busy === "save" ? t("settingsSaving") : t("settingsSave")}</button></footer>
  </main>
}

function withLinks(text: string, links: Array<{ phrase: string; href: string }>): ReactNode {
  const earliest = links
    .map((link) => ({ ...link, index: text.indexOf(link.phrase) }))
    .filter((link) => link.index >= 0)
    .sort((left, right) => left.index - right.index)[0]
  if (!earliest) return text
  const before = text.slice(0, earliest.index)
  const after = text.slice(earliest.index + earliest.phrase.length)
  return <>{before}<a href={earliest.href} rel="noreferrer" target="_blank">{earliest.phrase}</a>{withLinks(after, links)}</>
}

function TencentGuide() {
  return <details className="cos-settings-guide"><summary>{t("settingsTencentSummary")}</summary><p className="cos-settings-guide__note">{t("settingsTencentNote")}</p><ol><li>{withLinks(t("settingsTencentStep1"), [{ phrase: t("settingsTencentConsole"), href: "https://console.cloud.tencent.com/cos" }])}</li><li>{t("settingsTencentStep2")}</li><li>{withLinks(t("settingsTencentStep3"), [{ phrase: t("settingsTencentUsers"), href: "https://console.cloud.tencent.com/cam/user" }])}</li><li>{withLinks(t("settingsTencentStep4"), [{ phrase: t("settingsTencentKeys"), href: "https://console.cloud.tencent.com/cam/capi" }])}</li><li>{t("settingsTencentStep5")}</li><li>{t("settingsTencentStep6")}</li></ol><p className="cos-settings-guide__note cos-settings-guide__warning">{t("settingsTencentWarning")}</p></details>
}
function AliyunGuide() {
  return <details className="cos-settings-guide"><summary>{t("settingsAliyunSummary")}</summary><p className="cos-settings-guide__note">{t("settingsAliyunNote")}</p><ol><li>{withLinks(t("settingsAliyunStep1"), [{ phrase: t("settingsAliyunConsole"), href: "https://oss.console.aliyun.com/" }])}</li><li>{t("settingsAliyunStep2")}</li><li>{withLinks(t("settingsAliyunStep3"), [{ phrase: t("settingsAliyunUsers"), href: "https://ram.console.aliyun.com/users" }, { phrase: t("settingsAliyunPolicy"), href: "https://help.aliyun.com/zh/oss/user-guide/configure-bucket-policies" }])}</li><li>{withLinks(t("settingsAliyunStep4"), [{ phrase: t("settingsAliyunKeys"), href: "https://ram.console.aliyun.com/manage/ak" }])}</li><li>{withLinks(t("settingsAliyunStep5"), [{ phrase: t("settingsAliyunCors"), href: "https://help.aliyun.com/zh/oss/user-guide/configure-cross-origin-resource-sharing" }])}</li><li>{t("settingsAliyunStep6")}</li></ol><p className="cos-settings-guide__note cos-settings-guide__warning">{t("settingsAliyunWarning")}</p></details>
}

class CosSettingsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error("Rootline remote settings failed to render", error, info) }
  override render() { return this.state.failed ? <main className="cos-settings-shell"><Notice title={t("settingsLoadFailed")} tone="error">{t("settingsLoadFailedDetail")}</Notice></main> : this.props.children }
}

const container = document.getElementById("root")
if (!container) throw new Error("Rootline remote settings root element is missing.")
const root = (window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ ?? ReactDOM.createRoot(container)
;(window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ = root
root.render(<LocaleProvider><CosSettingsErrorBoundary><CosSettingsApp /></CosSettingsErrorBoundary></LocaleProvider>)
