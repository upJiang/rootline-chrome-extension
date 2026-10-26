/// <reference path="./aliyun-oss.d.ts" />
import OSS from "ali-oss"
import { t, type MessageKey } from "./i18n"
import type { AliyunOssConfig } from "./types"

export interface OssUploadProgress {
  loaded: number
  total: number
  percent: number
}

export interface PutOssObjectOptions {
  onProgress?: (progress: OssUploadProgress) => void
  contentDisposition?: string
}

function normalizedRegion(region: string): string {
  const value = region.trim().toLowerCase()
  return value.startsWith("oss-") ? value : `oss-${value}`
}

function endpoint(config: AliyunOssConfig): string {
  return `https://${normalizedRegion(config.region)}.aliyuncs.com`
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/")
}

export function buildOssObjectUrl(config: AliyunOssConfig, key: string): string {
  const base = config.publicBaseUrl?.replace(/\/+$/, "") ?? `https://${config.bucket}.${normalizedRegion(config.region)}.aliyuncs.com`
  return `${base}/${encodeObjectKey(key.replace(/^\/+/, ""))}`
}

export function joinOssKey(prefix: string, ...segments: string[]): string {
  const root = prefix.replace(/^\/+|\/+$/g, "")
  const rest = segments.map((segment) => segment.replace(/^\/+|\/+$/g, "")).filter(Boolean)
  return [root, ...rest].filter(Boolean).join("/")
}

function ossClient(config: AliyunOssConfig): OSS {
  return new OSS({
    region: normalizedRegion(config.region),
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: endpoint(config),
    secure: true,
    timeout: 30_000,
  })
}

function friendlyOssError(error: unknown, fallback: MessageKey): Error {
  const value = error as { code?: string; status?: number; statusCode?: number; message?: string; requestId?: string }
  const diagnostic = typeof value?.requestId === "string" && /^[A-Za-z0-9._:/+=-]{1,160}$/.test(value.requestId)
    ? t("errorDiagnostic", { detail: `requestId=${value.requestId}` })
    : ""
  if (value?.code === "InvalidAccessKeyId") return new Error(t("errorOssInvalidAccessKey", { diagnostic }))
  if (value?.code === "SignatureDoesNotMatch") return new Error(t("errorOssSignatureMismatch", { diagnostic }))
  if (value?.status === 403 || value?.statusCode === 403 || value?.code === "AccessDenied") return new Error(t("errorOssAccessDenied", { diagnostic }))
  if (value?.status === 404 || value?.statusCode === 404 || value?.code === "NoSuchBucket") return new Error(t("errorOssBucketMissing", { diagnostic }))
  if (value?.message?.toLowerCase().includes("cors") || value?.message?.toLowerCase().includes("network")) return new Error(t("errorOssNetwork"))
  return new Error(`${t(fallback)}${diagnostic}`)
}

export async function putOssObject(
  config: AliyunOssConfig,
  key: string,
  body: Blob,
  contentType: string,
  options: PutOssObjectOptions = {},
): Promise<void> {
  try {
    await ossClient(config).put(key, body, {
      mime: contentType,
      headers: {
        "Cache-Control": "no-store",
        ...(options.contentDisposition ? { "Content-Disposition": options.contentDisposition } : {}),
      },
      progress: async (percent: number) => options.onProgress?.({ loaded: Math.round(body.size * percent), total: body.size, percent }),
    })
    options.onProgress?.({ loaded: body.size, total: body.size, percent: 1 })
  } catch (error) {
    throw friendlyOssError(error, "errorOssUploadFailed")
  }
}

export async function deleteOssObject(config: AliyunOssConfig, key: string): Promise<void> {
  try {
    await ossClient(config).delete(key)
  } catch (error) {
    throw friendlyOssError(error, "errorOssCleanupFailed")
  }
}

export async function testAliyunOssConnection(config: AliyunOssConfig): Promise<AliyunOssConfig> {
  const nonce = crypto.randomUUID()
  const key = joinOssKey(config.objectPrefix, `.rootline-connection-test-${nonce}.txt`)
  const content = `rootline-connection-test:${nonce}`
  let operationError: unknown
  try {
    await putOssObject(config, key, new Blob([content], { type: "text/plain;charset=utf-8" }), "text/plain;charset=utf-8")
    const response = await fetch(`${buildOssObjectUrl(config, key)}?rootline-test=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) throw new Error(t("errorOssPublicRead"))
    if (response.headers.get("content-disposition")?.toLowerCase().includes("attachment")) throw new Error(t("errorOssForcedDownload"))
    if ((await response.text()) !== content) throw new Error(t("errorOssReadMismatch"))
    return { ...config, verifiedAt: new Date().toISOString() }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await deleteOssObject(config, key)
    } catch (error) {
      if (!operationError) throw new Error(t("errorOssDeleteFailed"), { cause: error })
    }
  }
}
