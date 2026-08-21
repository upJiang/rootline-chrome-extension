/// <reference path="./aliyun-oss.d.ts" />
import OSS from "ali-oss"
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

function friendlyOssError(error: unknown, fallback: string): Error {
  const value = error as { code?: string; status?: number; statusCode?: number; message?: string; requestId?: string }
  const diagnostic = typeof value?.requestId === "string" && /^[A-Za-z0-9._:/+=-]{1,160}$/.test(value.requestId)
    ? `（requestId=${value.requestId}）`
    : ""
  if (value?.code === "InvalidAccessKeyId") return new Error(`阿里云 OSS 不识别当前 AccessKey ID${diagnostic}，请确认密钥仍处于启用状态。`)
  if (value?.code === "SignatureDoesNotMatch") return new Error(`阿里云 OSS 请求签名不匹配${diagnostic}，请检查 Region、Bucket 和本机系统时间。`)
  if (value?.status === 403 || value?.statusCode === 403 || value?.code === "AccessDenied") return new Error(`阿里云 OSS 拒绝访问${diagnostic}，请检查 RAM 子用户是否拥有 rootline/* 的 PutObject、GetObject、HeadObject、DeleteObject 权限，以及 CORS 配置。`)
  if (value?.status === 404 || value?.statusCode === 404 || value?.code === "NoSuchBucket") return new Error(`找不到阿里云 OSS Bucket${diagnostic}，请检查 Bucket 和 Region。`)
  if (value?.message?.toLowerCase().includes("cors") || value?.message?.toLowerCase().includes("network")) return new Error("无法连接阿里云 OSS，请检查网络和 CORS 是否允许 PUT、GET、HEAD、DELETE、OPTIONS。")
  return new Error(`${fallback}${diagnostic}`)
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
    throw friendlyOssError(error, "阿里云 OSS 上传失败，请检查配置后重试。")
  }
}

export async function deleteOssObject(config: AliyunOssConfig, key: string): Promise<void> {
  try {
    await ossClient(config).delete(key)
  } catch (error) {
    throw friendlyOssError(error, "阿里云 OSS 文件清理失败。")
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
    if (!response.ok) throw new Error("测试文件已上传，但无法公开读取。请将 OSS 访问权限改为“公共读、私有写”，不要选择公共读写。")
    if (response.headers.get("content-disposition")?.toLowerCase().includes("attachment")) throw new Error("OSS 当前启用了强制下载，请将响应处置设置为 inline 后重新测试连接。")
    if ((await response.text()) !== content) throw new Error("OSS 测试文件读取结果不一致，请检查访问域名配置。")
    return { ...config, verifiedAt: new Date().toISOString() }
  } catch (error) {
    operationError = error
    throw error
  } finally {
    try {
      await deleteOssObject(config, key)
    } catch (error) {
      if (!operationError) throw new Error("测试文件已上传并可读取，但删除失败。请补充当前对象前缀的 DeleteObject 权限。", { cause: error })
    }
  }
}
