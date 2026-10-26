import COS from "cos-js-sdk-v5"
import { getLocale, t, type MessageKey } from "./i18n"
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
  if (!fields.length) return ""
  return t("errorDiagnostic", { detail: fields.join(getLocale() === "en" ? ", " : "，") })
}

function friendlyCosError(error: unknown, fallback: MessageKey): Error {
  const value = error as { code?: string; statusCode?: number; message?: string }
  const diagnostic = cosDiagnostic(error)
  if (value?.code === "InvalidAccessKeyId") return new Error(t("errorCosInvalidAccessKey", { diagnostic }))
  if (value?.code === "SignatureDoesNotMatch") return new Error(t("errorCosSignatureMismatch", { diagnostic }))
  if (value?.statusCode === 403 || value?.code === "AccessDenied") return new Error(t("errorCosAccessDenied", { diagnostic }))
  if (value?.statusCode === 404 || value?.code === "NoSuchBucket") return new Error(t("errorCosBucketMissing", { diagnostic }))
  if (value?.message?.toLowerCase().includes("timeout")) return new Error(t("errorCosTimeout", { diagnostic }))
  if (value?.message?.toLowerCase().includes("cors") || value?.message?.toLowerCase().includes("network")) return new Error(t("errorCosNetwork", { diagnostic }))
  return new Error(`${t(fallback)}${diagnostic}`)
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
    throw friendlyCosError(error, "errorCosUploadFailed")
  }
}

export async function deleteCosObject(config: TencentCosConfig, key: string): Promise<void> {
  try {
    await cosClient(config).deleteObject({ Bucket: config.bucket, Region: config.region, Key: key })
  } catch (error) {
    throw friendlyCosError(error, "errorCosCleanupFailed")
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
      throw new Error(t("errorCosPublicRead"))
    }
    const disposition = response.headers.get("content-disposition")?.toLowerCase() ?? ""
    if (disposition.includes("attachment")) {
      throw new Error(t("errorCosForcedDownload"))
    }
    if ((await response.text()) !== content) throw new Error(t("errorCosReadMismatch"))
    return { ...config, verifiedAt: new Date().toISOString() }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await deleteCosObject(config, key)
    } catch (error) {
      if (!operationError) {
        throw new Error(t("errorCosDeleteFailed"), { cause: error })
      }
    }
  }
}
