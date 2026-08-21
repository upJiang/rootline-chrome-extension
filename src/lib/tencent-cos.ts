import COS from "cos-js-sdk-v5"
import type { TencentCosConfig } from "./types"

function cosClient(config: TencentCosConfig): COS {
  return new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
    Protocol: "https:",
    Timeout: 30_000,
  })
}

export interface CosUploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface PutCosObjectOptions {
  onProgress?: (progress: CosUploadProgress) => void
  contentDisposition?: string
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/")
}

export function buildCosObjectUrl(config: TencentCosConfig, key: string): string {
  const base = config.publicBaseUrl?.replace(/\/+$/, "")
    ?? `https://${config.bucket}.cos.${config.region}.myqcloud.com`
  return `${base}/${encodeObjectKey(key.replace(/^\/+/, ""))}`
}

export function joinCosKey(prefix: string, ...segments: string[]): string {
  const root = prefix.replace(/^\/+|\/+$/g, "")
  const rest = segments.map((segment) => segment.replace(/^\/+|\/+$/g, "")).filter(Boolean)
  return [root, ...rest].filter(Boolean).join("/")
}

function safeDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const normalized = String(value).trim()
  return /^[A-Za-z0-9._:/+=-]{1,160}$/.test(normalized) ? normalized : undefined
}

function cosDiagnostic(error: unknown): string {
  const value = error as {
    code?: unknown
    statusCode?: unknown
    requestId?: unknown
    RequestId?: unknown
    headers?: Record<string, unknown>
  }
  const code = safeDiagnostic(value?.code)
  const status = safeDiagnostic(value?.statusCode)
  const requestId = safeDiagnostic(
    value?.requestId
    ?? value?.RequestId
    ?? value?.headers?.["x-cos-request-id"],
  )
  const fields = [
    ...(code ? [`code=${code}`] : []),
    ...(status ? [`status=${status}`] : []),
    ...(requestId ? [`requestId=${requestId}`] : []),
  ]
  return fields.length ? `（${fields.join("，")}）` : ""
}

function friendlyCosError(error: unknown, fallback: string): Error {
  const value = error as { code?: string; statusCode?: number; message?: string }
  const diagnostic = cosDiagnostic(error)
  if (value?.code === "InvalidAccessKeyId") {
    return new Error(`腾讯云 COS 不识别当前 SecretId，请确认密钥仍处于启用状态${diagnostic}。`)
  }
  if (value?.code === "SignatureDoesNotMatch") {
    return new Error(`腾讯云 COS 请求签名不匹配${diagnostic}。请确认电脑系统时间准确，并检查 Bucket、Region 与刚才测试成功的配置一致；这不等同于 SecretKey 无效。`)
  }
  if (value?.statusCode === 403 || value?.code === "AccessDenied") {
    return new Error(`腾讯云 COS 拒绝访问${diagnostic}。请检查子账号是否拥有 COS 对象权限（PutObject、GetObject、HeadObject、DeleteObject）。QcloudCollApiKeyManageAccess 只管理 API 密钥，不包含 COS 读写权限；同时检查 Bucket、Region 和 CORS 配置。`)
  }
  if (value?.statusCode === 404 || value?.code === "NoSuchBucket") {
    return new Error(`找不到腾讯云 COS 存储桶${diagnostic}，请检查 Bucket 和 Region。`)
  }
  if (value?.message?.toLowerCase().includes("timeout")) {
    return new Error(`腾讯云 COS 请求超时${diagnostic}。Rootline 已核对远程对象但未确认上传完成，请检查网络后重试。`)
  }
  if (value?.message?.toLowerCase().includes("cors") || value?.message?.toLowerCase().includes("network")) {
    return new Error(`无法连接腾讯云 COS${diagnostic}，请检查网络和 CORS 是否允许 PUT、GET、HEAD、DELETE、OPTIONS。`)
  }
  return new Error(`${fallback}${diagnostic}`)
}

function uploadBodySize(body: Blob | string): number {
  return body instanceof Blob ? body.size : new TextEncoder().encode(body).byteLength
}

async function uploadedObjectMatches(
  client: COS,
  config: TencentCosConfig,
  key: string,
  expectedSize: number,
  uploadStartedAt: number,
): Promise<boolean> {
  try {
    const result = await client.headObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
    })
    const headers = result.headers as Record<string, string | undefined>
    const contentLength = Number(headers?.["content-length"])
    const lastModified = Date.parse(headers?.["last-modified"] ?? "")
    const recentEnough = !Number.isFinite(lastModified) || lastModified >= uploadStartedAt - 120_000
    return contentLength === expectedSize && recentEnough
  } catch {
    return false
  }
}

export async function putCosObject(
  config: TencentCosConfig,
  key: string,
  body: Blob | string,
  contentType: string,
  options: PutCosObjectOptions = {},
): Promise<void> {
  const client = cosClient(config)
  const contentLength = uploadBodySize(body)
  const uploadStartedAt = Date.now()
  try {
    await client.putObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
      Body: body,
      ContentLength: contentLength,
      ContentType: contentType,
      CacheControl: "no-store",
      ...(options.contentDisposition ? { ContentDisposition: options.contentDisposition } : {}),
      onProgress: (progress) => options.onProgress?.({
        loaded: progress.loaded,
        total: progress.total || contentLength,
        percent: progress.total > 0 ? progress.loaded / progress.total : progress.percent || 0,
      }),
    })
  } catch (error) {
    // COS can finish receiving an object while the browser loses or rejects the
    // final response. Confirm the exact object before showing a failed capture.
    if (await uploadedObjectMatches(client, config, key, contentLength, uploadStartedAt)) {
      options.onProgress?.({ loaded: contentLength, total: contentLength, percent: 1 })
      return
    }
    throw friendlyCosError(error, "腾讯云 COS 上传失败，请检查配置后重试。")
  }
}

export async function deleteCosObject(config: TencentCosConfig, key: string): Promise<void> {
  try {
    await cosClient(config).deleteObject({ Bucket: config.bucket, Region: config.region, Key: key })
  } catch (error) {
    throw friendlyCosError(error, "腾讯云 COS 文件清理失败。")
  }
}

export async function testTencentCosConnection(config: TencentCosConfig): Promise<TencentCosConfig> {
  const nonce = crypto.randomUUID()
  const key = joinCosKey(config.objectPrefix, `.rootline-connection-test-${nonce}.txt`)
  const content = `rootline-connection-test:${nonce}`
  const body = new Blob([content], { type: "text/plain;charset=utf-8" })
  let operationError: unknown
  try {
    // Match the Blob-based upload used by the real report path so the test also
    // exercises the same browser signing and CORS behavior.
    await putCosObject(config, key, body, "text/plain;charset=utf-8")
    const response = await fetch(`${buildCosObjectUrl(config, key)}?rootline-test=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error("测试文件已上传，但无法公开读取。请将存储桶访问权限改为“公有读、私有写”，不要选择“公有读写”。")
    }
    const disposition = response.headers.get("content-disposition")?.toLowerCase() ?? ""
    if (disposition.includes("attachment")) {
      throw new Error("COS 当前启用了“强制下载/下载文件”，report.html 会被浏览器直接下载。请在 COS 控制台关闭强制下载，并重新测试连接。")
    }
    if ((await response.text()) !== content) throw new Error("COS 测试文件读取结果不一致，请检查访问域名配置。")
    return { ...config, verifiedAt: new Date().toISOString() }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await deleteCosObject(config, key)
    } catch (error) {
      if (!operationError) {
        throw new Error("测试文件已上传并可读取，但删除失败。请为当前腾讯云密钥补充当前对象前缀的删除权限。", { cause: error })
      }
    }
  }
}
