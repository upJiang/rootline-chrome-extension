import "@fontsource/nunito/400.css"
import "@fontsource/nunito/600.css"
import "@fontsource/nunito/700.css"
import "@fontsource/fira-code/400.css"
import React, { Component, type ErrorInfo, type ReactNode } from "react"
import ReactDOM, { type Root } from "react-dom/client"
import { X } from "lucide-react"
import { Brand } from "../../components/Brand"
import { Notice } from "../../components/Notice"
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
  if (!response?.ok) throw new Error(response?.error ?? "Rootline 操作失败。")
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

function providerName(provider: RemoteProvider): string { return provider === "aliyun-oss" ? "阿里云 OSS" : "腾讯云 COS" }

export function CosSettingsApp() {
  const [saveConfig, setSaveConfig] = React.useState<CaptureSaveConfig | null>(null)
  const [provider, setProvider] = React.useState<RemoteProvider>("tencent-cos")
  const [form, setForm] = React.useState<FormState>(() => initialForm("tencent-cos"))
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const feedbackTimer = React.useRef<number | null>(null)

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

  React.useEffect(() => { void refresh().catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : "无法读取远程保存配置。" })).finally(() => setLoading(false)) }, [refresh, showFeedback])
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
  const run = async (label: string, operation: () => Promise<void>) => { setBusy(label); setFeedback(null); try { await operation() } catch (error: unknown) { showFeedback({ tone: "error", message: error instanceof Error ? error.message : "Rootline 操作失败。" }) } finally { setBusy(null) } }

  const save = () => run("save", async () => {
    const saved = await request<CaptureSaveConfig>({ type: "SAVE_REMOTE_CONFIG", config: configFromForm() })
    setSaveConfig(saved)
    setForm(initialForm(provider, provider === "aliyun-oss" ? saved.aliyunOss : saved.tencentCos ?? saved.remote))
    showFeedback({ tone: "success", message: `${providerName(provider)}配置已保存，远程保存已启用。` })
  })
  const test = () => run("test", async () => {
    const verified = await request<RemoteStorageConfig>({ type: "TEST_REMOTE_CONFIG", config: configFromForm() })
    const saved = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" })
    setSaveConfig(saved)
    setForm(initialForm(provider, verified))
    showFeedback({ tone: "success", message: `连接成功：${providerName(provider)}测试文件已上传、公开读取并删除。` })
  })
  const clear = () => run("clear", async () => {
    const next = await request<CaptureSaveConfig>({ type: "CLEAR_REMOTE_CONFIG", provider })
    setSaveConfig(next)
    setForm(initialForm(provider))
    showFeedback({ tone: "success", message: `${providerName(provider)}配置已清除，已有远程文件不会被删除。` })
  })
  const useLocal = () => run("local", async () => { await request({ type: "SET_SAVE_MODE", mode: "local" }); const next = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" }); setSaveConfig(next); showFeedback({ tone: "success", message: "已切换为本地保存，文件写入 Chrome 下载目录 / Rootline。" }) })

  if (loading) return <main className="cos-settings-shell cos-settings-loading">正在读取远程保存配置…</main>
  const currentConfig = provider === "aliyun-oss" ? saveConfig?.aliyunOss : saveConfig?.tencentCos ?? saveConfig?.remote

  return <main className="cos-settings-shell">
    <header className="cos-settings-header"><Brand /><div className="flex items-center gap-3"><span className="rl-muted text-xs">远程保存配置</span><button aria-label="关闭配置窗口" className="rl-button rl-icon-button" onClick={() => window.close()} title="关闭窗口" type="button"><X aria-hidden="true" size={17} /></button></div></header>
    <section className="cos-settings-intro"><p className="cos-settings-eyebrow">Remote storage</p><h1>选择云服务商</h1><p>Rootline 会将报告、截图和录屏直接上传到你自己的对象存储，不经过 Rootline 服务器。</p></section>
    {feedback ? <Notice title={feedback.message} tone={feedback.tone} /> : null}
    <div aria-label="云服务商" className="provider-tabs" role="tablist"><button aria-selected={provider === "tencent-cos"} onClick={() => selectProvider("tencent-cos")} role="tab" type="button">腾讯云 COS</button><button aria-selected={provider === "aliyun-oss"} onClick={() => selectProvider("aliyun-oss")} role="tab" type="button">阿里云 OSS</button></div>
    <section className="cos-settings-card" aria-labelledby="permission-title"><div className="cos-settings-permission-icon" aria-hidden="true">!</div><div><h2 id="permission-title">访问权限请选择“{provider === "aliyun-oss" ? "公共读、私有写" : "公有读、私有写"}”</h2><p>不要选择“公有读写”或“公共读写”。公共读用于让 AI 读取报告，私有写用于防止陌生人上传、覆盖或删除文件。</p></div></section>
    <section className="cos-settings-card cos-settings-form-card" aria-labelledby="form-title"><div className="cos-settings-section-heading"><div><p className="cos-settings-eyebrow">Credentials</p><h2 id="form-title">{providerName(provider)}信息</h2></div><span>{currentConfig ? "已配置" : "尚未配置"}</span></div><div className="cos-settings-form"><label><span>Bucket</span><input aria-label="Bucket" className="rl-field" onChange={(event) => updateField("bucket", event.target.value)} placeholder={provider === "aliyun-oss" ? "rootline-evidence" : "rootline-1250000000"} value={form.bucket} /></label><label><span>Region</span><input aria-label="Region" className="rl-field" onChange={(event) => updateField("region", event.target.value)} placeholder={provider === "aliyun-oss" ? "cn-guangzhou" : "ap-guangzhou"} value={form.region} /></label>{provider === "aliyun-oss" ? <><label><span>AccessKey ID</span><input aria-label="AccessKey ID" autoComplete="off" className="rl-field" onChange={(event) => updateField("accessKeyId", event.target.value)} placeholder="阿里云 AccessKey ID" value={form.accessKeyId} /></label><label><span>AccessKey Secret</span><input aria-label="AccessKey Secret" autoComplete="new-password" className="rl-field" onChange={(event) => updateField("accessKeySecret", event.target.value)} placeholder="阿里云 AccessKey Secret" type="password" value={form.accessKeySecret} /></label></> : <><label><span>SecretId</span><input aria-label="SecretId" autoComplete="off" className="rl-field" onChange={(event) => updateField("secretId", event.target.value)} placeholder="腾讯云 SecretId" value={form.secretId} /></label><label><span>SecretKey</span><input aria-label="SecretKey" autoComplete="new-password" className="rl-field" onChange={(event) => updateField("secretKey", event.target.value)} placeholder="腾讯云 SecretKey" type="password" value={form.secretKey} /></label></>}<label><span>对象前缀</span><input aria-label="对象前缀" className="rl-field" onChange={(event) => updateField("objectPrefix", event.target.value)} placeholder="rootline/" value={form.objectPrefix} /></label><label><span>自定义访问域名（可选）</span><input aria-label="自定义访问域名" className="rl-field" onChange={(event) => updateField("publicBaseUrl", event.target.value)} placeholder="https://evidence.example.com" value={form.publicBaseUrl} /></label></div></section>
    {provider === "aliyun-oss" ? <AliyunGuide /> : <TencentGuide />}
    <p className="cos-settings-privacy">Rootline 不提供云端服务，不会保存或接收你的报告、截图、录屏和网页内容。文件只会直接上传到你配置的对象存储；凭证只保存在当前浏览器扩展本地存储，不会写入报告。</p>
    <footer className="cos-settings-actions"><button className="rl-button" disabled={busy !== null} onClick={() => void useLocal()} type="button">切换为本地保存</button><span className="cos-settings-actions__spacer" />{currentConfig ? <button className="rl-button rl-button--danger" disabled={busy !== null} onClick={() => void clear()} type="button">清除配置</button> : null}<button className="rl-button" data-state={busy === "test" ? "loading" : undefined} disabled={busy !== null} onClick={() => void test()} type="button">{busy === "test" ? "正在测试" : "测试连接"}</button><button className="rl-button rl-button--primary" data-state={busy === "save" ? "loading" : undefined} disabled={busy !== null} onClick={() => void save()} type="button">{busy === "save" ? "正在保存" : "保存配置"}</button></footer>
  </main>
}

function TencentGuide() { return <details className="cos-settings-guide"><summary>腾讯云配置教程：创建子用户、分配权限和创建密钥</summary><p className="cos-settings-guide__note">推荐使用只授权 Rootline 对象前缀的 CAM 子用户，也可以使用已有密钥；不需要填写子账号 ID。</p><ol><li>打开<a href="https://console.cloud.tencent.com/cos" rel="noreferrer" target="_blank">腾讯云 COS 控制台</a>创建存储桶，记录完整 Bucket 和 Region，访问权限选择“公有读、私有写”。</li><li>在存储桶域名或对象元数据中关闭“强制下载”，将 <code>Content-Disposition</code> 设置为 <code>inline</code>。</li><li>在<a href="https://console.cloud.tencent.com/cam/user" rel="noreferrer" target="_blank">CAM 用户管理</a>创建子用户，并为 <code>rootline/*</code> 授予 PutObject、GetObject、HeadObject、DeleteObject。</li><li>在子用户 API 密钥页创建 SecretId 和 SecretKey，也可以打开<a href="https://console.cloud.tencent.com/cam/capi" rel="noreferrer" target="_blank">API 密钥管理</a>。不要只授予 <code>QcloudCollApiKeyManageAccess</code>。</li><li>在“安全管理 → 跨域访问 CORS”允许 PUT、GET、HEAD、DELETE、OPTIONS，并暴露 Content-Disposition、Content-Type、Content-Length、ETag。</li><li>建议设置 7 天或 30 天生命周期自动清理历史采集记录。</li></ol><p className="cos-settings-guide__note cos-settings-guide__warning">若测试返回 403，检查 Bucket 是否包含主账号 APPID 后缀、对象权限和 CORS。</p></details> }
function AliyunGuide() {
  return <details className="cos-settings-guide"><summary>阿里云 OSS 配置教程：创建 RAM 子用户、分配权限和创建密钥</summary><p className="cos-settings-guide__note">推荐使用只授权 Rootline 对象前缀的 RAM 子用户。Rootline 采用浏览器端 AccessKey 直连，不需要部署 Rootline 服务。</p><ol><li>打开<a href="https://oss.console.aliyun.com/" rel="noreferrer" target="_blank">阿里云 OSS 控制台</a>创建 Bucket，记录 Bucket 和 Region，读写权限选择“公共读、私有写”。</li><li>在 Bucket 域名或对象元数据中关闭“强制下载”，将 <code>Content-Disposition</code> 设置为 <code>inline</code>。</li><li>打开<a href="https://ram.console.aliyun.com/users" rel="noreferrer" target="_blank">RAM 用户管理</a>创建子用户，按<a href="https://help.aliyun.com/zh/oss/user-guide/configure-bucket-policies" rel="noreferrer" target="_blank">Bucket Policy 文档</a>为当前 Bucket 的 <code>rootline/*</code> 前缀授予 PutObject、GetObject、HeadObject、DeleteObject。</li><li>在 RAM 用户的“认证管理 → AccessKey”创建 AccessKey ID 和 AccessKey Secret，也可以打开<a href="https://ram.console.aliyun.com/manage/ak" rel="noreferrer" target="_blank">AccessKey 管理</a>。不要使用阿里云主账号密钥。</li><li>在 OSS 的“数据安全 → 跨域设置 CORS”允许 PUT、GET、HEAD、DELETE、OPTIONS，并暴露 Content-Disposition、Content-Type、Content-Length、ETag，参考<a href="https://help.aliyun.com/zh/oss/user-guide/configure-cross-origin-resource-sharing" rel="noreferrer" target="_blank">OSS CORS 文档</a>。</li><li>建议设置 7 天或 30 天生命周期自动清理旧采集记录。AccessKey 不要粘贴到报告、工单或聊天记录。</li></ol><p className="cos-settings-guide__note cos-settings-guide__warning">若测试返回 403，检查 RAM 对象权限、Bucket 访问权限、Region 和 CORS。公共读用于 AI 读取，切勿开启公共读写。</p></details>
}

class CosSettingsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error("Rootline remote settings failed to render", error, info) }
  override render() { return this.state.failed ? <main className="cos-settings-shell"><Notice title="远程保存配置界面加载失败" tone="error">请关闭窗口后重新打开。</Notice></main> : this.props.children }
}

const container = document.getElementById("root")
if (!container) throw new Error("Rootline remote settings root element is missing.")
const root = (window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ ?? ReactDOM.createRoot(container)
;(window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ = root
root.render(<CosSettingsErrorBoundary><CosSettingsApp /></CosSettingsErrorBoundary>)
