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

function friendlyCosError(error: unknown, fallback: string): Error {
  const value = error as { code?: string; statusCode?: number; message?: string }
  if (value?.code === "InvalidAccessKeyId" || value?.code === "SignatureDoesNotMatch") {
    return new Error("腾讯云 COS 凭证无效，请检查 SecretId 和 SecretKey。")
  }
  if (value?.statusCode === 403 || value?.code === "AccessDenied") {
    return new Error("腾讯云 COS 拒绝访问，请检查子账号是否拥有 COS 对象权限（PutObject、GetObject、HeadObject、DeleteObject）。QcloudCollApiKeyManageAccess 只管理 API 密钥，不包含 COS 读写权限；同时检查 Bucket、Region 和 CORS 配置。")
  }
  if (value?.statusCode === 404 || value?.code === "NoSuchBucket") {
    return new Error("找不到腾讯云 COS 存储桶，请检查 Bucket 和 Region。")
  }
  if (value?.message?.toLowerCase().includes("cors") || value?.message?.toLowerCase().includes("network")) {
    return new Error("无法连接腾讯云 COS，请检查网络和 CORS 是否允许 PUT、GET、HEAD、DELETE、OPTIONS。")
  }
  return new Error(fallback)
}

export async function putCosObject(
  config: TencentCosConfig,
  key: string,
  body: Blob | string,
  contentType: string,
): Promise<void> {
  try {
    await cosClient(config).putObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "no-store",
    })
  } catch (error) {
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
  let operationError: unknown
  try {
    await putCosObject(config, key, content, "text/plain;charset=utf-8")
    const response = await fetch(`${buildCosObjectUrl(config, key)}?rootline-test=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error("测试文件已上传，但无法公开读取。请将存储桶访问权限改为“公有读、私有写”，不要选择“公有读写”。")
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
