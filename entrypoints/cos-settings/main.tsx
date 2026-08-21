import "@fontsource/nunito/400.css"
import "@fontsource/nunito/600.css"
import "@fontsource/nunito/700.css"
import "@fontsource/fira-code/400.css"
import React, { Component, type ErrorInfo, type ReactNode } from "react"
import ReactDOM, { type Root } from "react-dom/client"
import { Brand } from "../../components/Brand"
import { Notice } from "../../components/Notice"
import type { ExtensionResponse } from "../../src/lib/messaging"
import type { CaptureSaveConfig } from "../../src/lib/remote-config"
import type { TencentCosConfig } from "../../src/lib/types"
import "../../styles/globals.css"
import "../../styles/components.css"
import "./style.css"

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? "Rootline 操作失败。")
  return response.data as T
}

function initialForm(config?: TencentCosConfig) {
  return config ? {
    bucket: config.bucket,
    region: config.region,
    secretId: config.secretId,
    secretKey: config.secretKey,
    objectPrefix: config.objectPrefix,
    publicBaseUrl: config.publicBaseUrl ?? "",
    configuredAt: config.configuredAt,
    verifiedAt: config.verifiedAt ?? "",
  } : {
    bucket: "",
    region: "ap-guangzhou",
    secretId: "",
    secretKey: "",
    objectPrefix: "rootline/",
    publicBaseUrl: "",
    configuredAt: "",
    verifiedAt: "",
  }
}

type Feedback = { tone: "success" | "error"; message: string }

export function CosSettingsApp() {
  const [saveConfig, setSaveConfig] = React.useState<CaptureSaveConfig | null>(null)
  const [form, setForm] = React.useState(() => initialForm())
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const feedbackTimer = React.useRef<number | null>(null)

  const showFeedback = React.useCallback((next: Feedback) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    setFeedback(next)
    feedbackTimer.current = next.tone === "success"
      ? window.setTimeout(() => {
          setFeedback(null)
          feedbackTimer.current = null
        }, 3_000)
      : null
  }, [])

  const refresh = React.useCallback(async () => {
    const next = await request<CaptureSaveConfig>({ type: "GET_SAVE_CONFIG" })
    setSaveConfig(next)
    setForm(initialForm(next.remote))
  }, [])

  React.useEffect(() => {
    void refresh()
      .catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : "无法读取腾讯云 COS 配置。" }))
      .finally(() => setLoading(false))
  }, [refresh, showFeedback])

  React.useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
  }, [])

  const configFromForm = (): TencentCosConfig => ({
    provider: "tencent-cos",
    bucket: form.bucket,
    region: form.region,
    secretId: form.secretId,
    secretKey: form.secretKey,
    objectPrefix: form.objectPrefix,
    ...(form.publicBaseUrl.trim() ? { publicBaseUrl: form.publicBaseUrl } : {}),
    configuredAt: form.configuredAt || new Date().toISOString(),
    ...(form.verifiedAt ? { verifiedAt: form.verifiedAt } : {}),
  })

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label)
    setFeedback(null)
    try {
      await operation()
    } catch (error: unknown) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "Rootline 操作失败。" })
    } finally {
      setBusy(null)
    }
  }

  const save = () => run("save", async () => {
    const saved = await request<CaptureSaveConfig>({ type: "SAVE_COS_CONFIG", config: configFromForm() })
    setSaveConfig(saved)
    setForm(initialForm(saved.remote))
    showFeedback({ tone: "success", message: "腾讯云 COS 配置已保存，远程保存已启用。" })
  })

  const test = () => run("test", async () => {
    const verified = await request<TencentCosConfig>({ type: "TEST_COS_CONFIG", config: configFromForm() })
    setSaveConfig({ mode: "remote", remote: verified })
    setForm(initialForm(verified))
    showFeedback({ tone: "success", message: "连接成功：配置已自动保存，测试文件已上传、公开读取并删除。" })
  })

  const clear = () => run("clear", async () => {
    const next = await request<CaptureSaveConfig>({ type: "CLEAR_COS_CONFIG" })
    setSaveConfig(next)
    setForm(initialForm())
    showFeedback({ tone: "success", message: "远程配置已清除，COS 中已有文件不会被删除。" })
  })

  const useLocal = () => run("local", async () => {
    const next = await request<CaptureSaveConfig>({ type: "SET_SAVE_MODE", mode: "local" })
    setSaveConfig(next)
    showFeedback({ tone: "success", message: "已切换为本地保存，文件写入 Chrome 下载目录 / Rootline。" })
  })

  const updateField = (field: keyof ReturnType<typeof initialForm>, value: string) => {
    setForm((current) => ({ ...current, [field]: value, ...(field !== "verifiedAt" ? { verifiedAt: "" } : {}) }))
  }

  if (loading) return <main className="cos-settings-shell cos-settings-loading">正在读取腾讯云 COS 配置…</main>

  return (
    <main className="cos-settings-shell">
      <header className="cos-settings-header">
        <Brand />
        <button aria-label="关闭配置窗口" className="rl-button" onClick={() => window.close()} type="button">关闭</button>
      </header>

      <section className="cos-settings-intro">
        <p className="cos-settings-eyebrow">Remote storage</p>
        <h1>腾讯云 COS 配置</h1>
        <p>这个窗口用于配置你自己的 COS。保存后，Rootline 会在远程模式下直接上传到你的存储桶，不经过 Rootline 服务器。</p>
      </section>

      {feedback ? <Notice title={feedback.message} tone={feedback.tone} /> : null}

      <section className="cos-settings-card" aria-labelledby="cos-settings-permission-title">
        <div className="cos-settings-permission-icon" aria-hidden="true">!</div>
        <div>
          <h2 id="cos-settings-permission-title">访问权限请选择“公有读、私有写”</h2>
          <p>不要选择“公有读写”。公有读供 AI 读取报告，私有写防止陌生人上传、覆盖或删除文件。Rootline 不要求公有写权限。</p>
          <p className="cos-settings-help">不需要填写子账号 ID：COS 使用 SecretId 和 SecretKey 识别子账号。Bucket 请填写完整存储桶名称（通常是 <code>存储桶名称-主账号APPID</code>），这里的 APPID 不是子账号 ID。</p>
        </div>
      </section>

      <section className="cos-settings-card cos-settings-form-card" aria-labelledby="cos-form-title">
        <div className="cos-settings-section-heading"><div><p className="cos-settings-eyebrow">Credentials</p><h2 id="cos-form-title">存储桶信息</h2></div><span>{saveConfig?.mode === "remote" ? "远程保存已启用" : "当前使用本地保存"}</span></div>
        <div className="cos-settings-form">
          <label><span>Bucket（含主账号 APPID 后缀）</span><input aria-label="Bucket" className="rl-field" onChange={(event) => updateField("bucket", event.target.value)} placeholder="rootline-1250000000" title="请填写完整 Bucket 名称，末尾通常包含主账号 APPID" value={form.bucket} /></label>
          <label><span>Region</span><input aria-label="Region" className="rl-field" onChange={(event) => updateField("region", event.target.value)} placeholder="ap-guangzhou" value={form.region} /></label>
          <label><span>SecretId</span><input aria-label="SecretId" autoComplete="off" className="rl-field" onChange={(event) => updateField("secretId", event.target.value)} placeholder="腾讯云 SecretId" value={form.secretId} /></label>
          <label><span>SecretKey</span><input aria-label="SecretKey" autoComplete="new-password" className="rl-field" onChange={(event) => updateField("secretKey", event.target.value)} placeholder="腾讯云 SecretKey" type="password" value={form.secretKey} /></label>
          <label><span>对象前缀</span><input aria-label="对象前缀" className="rl-field" onChange={(event) => updateField("objectPrefix", event.target.value)} placeholder="rootline/" value={form.objectPrefix} /></label>
          <label><span>自定义访问域名（可选）</span><input aria-label="自定义访问域名" className="rl-field" onChange={(event) => updateField("publicBaseUrl", event.target.value)} placeholder="https://evidence.example.com" value={form.publicBaseUrl} /></label>
        </div>
        <p className="cos-settings-help">Rootline 只需要对对象前缀执行上传、读取和删除。使用子账号密钥时，不要把 <code>QcloudCollApiKeyManageAccess</code> 当作 COS 权限：它只管理 API 密钥，不允许上传或读取 COS 文件。请按下面教程给子账号分配 COS 对象权限。</p>
      </section>

      <details className="cos-settings-guide" open>
        <summary>腾讯云配置教程：创建子用户、分配权限和创建密钥</summary>
        <p className="cos-settings-guide__note">推荐使用只授权 Rootline 对象前缀的 CAM 子用户。你也可以使用已有密钥，但不需要在 Rootline 里额外填写子账号 ID。</p>
        <ol>
          <li>创建存储桶：打开 <a href="https://console.cloud.tencent.com/cos" rel="noreferrer" target="_blank">腾讯云 COS 控制台</a>，记录完整 Bucket 名称和 Region。访问权限选择“公有读、私有写”，不要开启公有写。</li>
          <li>关闭强制下载：在存储桶的基础配置或域名访问设置中，关闭“强制下载”“下载文件”或把响应处置设为 <code>inline</code>。否则浏览器会把 <code>report.html</code> 当附件下载，无法直接打开报告页面；关闭后请重新测试连接。</li>
          <li>创建子用户：打开 <a href="https://console.cloud.tencent.com/cam/user" rel="noreferrer" target="_blank">CAM 用户管理</a>，选择“新建用户”，创建一个仅用于 Rootline 的子用户。官方说明见 <a href="https://cloud.tencent.com/document/product/598/13674" rel="noreferrer" target="_blank">创建子用户文档</a>。</li>
          <li>分配 COS 权限：在子用户的“权限”中添加 COS 对象权限，至少允许 <code>PutObject</code>、<code>GetObject</code>、<code>HeadObject</code>、<code>DeleteObject</code>，资源限制到当前 Bucket 的 <code>rootline/*</code> 前缀，不授予列出整个存储桶的权限。参考 <a href="https://cloud.tencent.com/document/product/436/11714" rel="noreferrer" target="_blank">COS 访问策略文档</a>。不要只添加 <code>QcloudCollApiKeyManageAccess</code>，它不是 COS 数据权限。</li>
          <li>创建密钥：进入子用户的“API 密钥”页，点击“新建密钥”，复制一次性显示的 SecretId 和 SecretKey。也可以直接打开 <a href="https://console.cloud.tencent.com/cam/capi" rel="noreferrer" target="_blank">API 密钥管理</a>，官方说明见 <a href="https://cloud.tencent.com/document/product/598/32675" rel="noreferrer" target="_blank">访问密钥文档</a>。</li>
          <li>配置 CORS：在 COS 存储桶的“安全管理 → 跨域访问 CORS”中允许 <code>PUT</code>、<code>GET</code>、<code>HEAD</code>、<code>DELETE</code>、<code>OPTIONS</code>，并暴露 <code>Content-Disposition</code>、<code>Content-Type</code>、<code>Content-Length</code>、<code>ETag</code> 响应头，参考 <a href="https://cloud.tencent.com/document/product/436/13318" rel="noreferrer" target="_blank">CORS 配置文档</a>。</li>
          <li>建议设置 7 天或 30 天生命周期自动清理旧采集记录，不要把 SecretId 或 SecretKey 粘贴到报告、工单或聊天记录中。</li>
        </ol>
        <p className="cos-settings-guide__note cos-settings-guide__warning">如果测试连接返回 403，优先检查子用户是否拥有 COS 对象权限、Bucket 是否填写了主账号 APPID 后缀，以及 CORS 是否允许上述方法。若提示“强制下载”，请关闭 COS 的“强制下载/下载文件”选项。通常不需要添加任何子账号 ID。</p>
      </details>

      <p className="cos-settings-privacy">Rootline 不提供云端服务，不会保存或接收你的报告、截图、录屏和网页内容。文件只会直接上传到你配置的腾讯云 COS；凭证只保存在当前浏览器扩展本地存储，不会发送给 Rootline，也不会写入报告。公有读链接泄露后，获得链接的人可以读取报告。</p>

      <footer className="cos-settings-actions">
        <button className="rl-button" disabled={busy !== null} onClick={() => void useLocal()} type="button">切换为本地保存</button>
        <span className="cos-settings-actions__spacer" />
        {saveConfig?.remote ? <button className="rl-button rl-button--danger" disabled={busy !== null} onClick={() => void clear()} type="button">清除远程配置</button> : null}
        <button className="rl-button" data-state={busy === "test" ? "loading" : undefined} disabled={busy !== null} onClick={() => void test()} type="button">{busy === "test" ? "正在测试" : "测试连接"}</button>
        <button className="rl-button rl-button--primary" data-state={busy === "save" ? "loading" : undefined} disabled={busy !== null} onClick={() => void save()} type="button">{busy === "save" ? "正在保存" : "保存配置"}</button>
      </footer>
    </main>
  )
}

class CosSettingsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Rootline COS settings failed to render", error, errorInfo)
  }

  override render() {
    if (this.state.failed) return <main className="cos-settings-shell"><Notice title="腾讯云 COS 配置界面加载失败" tone="error">请关闭窗口后重新打开。</Notice></main>
    return this.props.children
  }
}

const container = document.getElementById("root")
if (!container) throw new Error("Rootline COS settings root element is missing.")
const root = (window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ ?? ReactDOM.createRoot(container)
;(window as Window & { __ROOTLINE_COS_SETTINGS_ROOT__?: Root }).__ROOTLINE_COS_SETTINGS_ROOT__ = root
root.render(<React.StrictMode><CosSettingsErrorBoundary><CosSettingsApp /></CosSettingsErrorBoundary></React.StrictMode>)
