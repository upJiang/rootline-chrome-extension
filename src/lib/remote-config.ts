import { z } from "zod"
import type { AliyunOssConfig, CaptureSaveMode, RemoteProvider, TencentCosConfig } from "./types"

const STORAGE_KEY = "rootline:capture-save-config"

export interface CaptureSaveConfig {
  mode: CaptureSaveMode
  provider?: RemoteProvider
  tencentCos?: TencentCosConfig
  aliyunOss?: AliyunOssConfig
  /** @deprecated v1 compatibility alias. */
  remote?: TencentCosConfig
}

const configSchema = z.object({
  provider: z.literal("tencent-cos"),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]*-[0-9]+$/, "Bucket 应为名称-APPID，例如 rootline-1250000000。"),
  region: z.string().trim().min(3).max(32).regex(/^[a-z0-9-]+$/, "Region 格式不正确，例如 ap-guangzhou。"),
  secretId: z.string().trim().min(8, "请输入有效的 SecretId。"),
  secretKey: z.string().trim().min(8, "请输入有效的 SecretKey。"),
  objectPrefix: z.string().trim().min(1).max(128),
  publicBaseUrl: z.string().trim().url("自定义访问域名必须是完整的 HTTPS 地址。").optional(),
  configuredAt: z.string(),
  verifiedAt: z.string().optional(),
})

const aliyunConfigSchema = z.object({
  provider: z.literal("aliyun-oss"),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9-]*$/, "Bucket 格式不正确。"),
  region: z.string().trim().min(3).max(64).regex(/^[a-z0-9-]+$/, "Region 格式不正确，例如 cn-guangzhou。"),
  accessKeyId: z.string().trim().min(8, "请输入有效的 AccessKey ID。"),
  accessKeySecret: z.string().trim().min(8, "请输入有效的 AccessKey Secret。"),
  objectPrefix: z.string().trim().min(1).max(128),
  publicBaseUrl: z.string().trim().url("自定义访问域名必须是完整的 HTTPS 地址。").optional(),
  configuredAt: z.string(),
  verifiedAt: z.string().optional(),
})

function normalizePrefix(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  if (!normalized) return "rootline/"
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("对象前缀包含无效目录段。")
  }
  return `${normalized}/`
}

function normalizeBaseUrl(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\/+$/, "")
  if (!normalized) return undefined
  const url = new URL(normalized)
  if (url.protocol !== "https:") throw new Error("自定义访问域名必须使用 HTTPS。")
  return url.toString().replace(/\/$/, "")
}

export function normalizeTencentCosConfig(
  value: Omit<TencentCosConfig, "provider" | "configuredAt"> & Partial<Pick<TencentCosConfig, "provider" | "configuredAt">>,
): TencentCosConfig {
  const baseUrl = normalizeBaseUrl(value.publicBaseUrl)
  const candidate: TencentCosConfig = {
    provider: "tencent-cos",
    bucket: value.bucket.trim().toLowerCase(),
    region: value.region.trim().toLowerCase(),
    secretId: value.secretId.trim(),
    secretKey: value.secretKey.trim(),
    objectPrefix: normalizePrefix(value.objectPrefix || "rootline/"),
    ...(baseUrl ? { publicBaseUrl: baseUrl } : {}),
    configuredAt: value.configuredAt ?? new Date().toISOString(),
    ...(value.verifiedAt ? { verifiedAt: value.verifiedAt } : {}),
  }
  const parsed = configSchema.parse(candidate)
  return parsed as TencentCosConfig
}

export function normalizeAliyunOssConfig(
  value: Omit<AliyunOssConfig, "provider" | "configuredAt"> & Partial<Pick<AliyunOssConfig, "provider" | "configuredAt">>,
): AliyunOssConfig {
  const baseUrl = normalizeBaseUrl(value.publicBaseUrl)
  const candidate: AliyunOssConfig = {
    provider: "aliyun-oss",
    bucket: value.bucket.trim().toLowerCase(),
    region: value.region.trim().toLowerCase(),
    accessKeyId: value.accessKeyId.trim(),
    accessKeySecret: value.accessKeySecret.trim(),
    objectPrefix: normalizePrefix(value.objectPrefix || "rootline/"),
    ...(baseUrl ? { publicBaseUrl: baseUrl } : {}),
    configuredAt: value.configuredAt ?? new Date().toISOString(),
    ...(value.verifiedAt ? { verifiedAt: value.verifiedAt } : {}),
  }
  return aliyunConfigSchema.parse(candidate) as AliyunOssConfig
}

export async function readCaptureSaveConfig(): Promise<CaptureSaveConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY] as CaptureSaveConfig | undefined
  if (!value) return { mode: "local", provider: "tencent-cos" }
  const mode: CaptureSaveMode = value.mode === "remote" ? "remote" : "local"
  const legacy = value.remote
  const tencentCos = value.tencentCos ?? legacy
  let normalizedTencent: TencentCosConfig | undefined
  let normalizedAliyun: AliyunOssConfig | undefined
  try { if (tencentCos) normalizedTencent = normalizeTencentCosConfig(tencentCos) } catch { /* ignore invalid stored credentials */ }
  try { if (value.aliyunOss) normalizedAliyun = normalizeAliyunOssConfig(value.aliyunOss) } catch { /* ignore invalid stored credentials */ }
  const provider = value.provider === "aliyun-oss" ? "aliyun-oss" : "tencent-cos"
  return {
    mode: mode === "remote" && ((provider === "aliyun-oss" && normalizedAliyun) || (provider === "tencent-cos" && normalizedTencent)) ? "remote" : mode === "remote" ? "local" : "local",
    provider,
    ...(normalizedTencent ? { tencentCos: normalizedTencent, remote: normalizedTencent } : {}),
    ...(normalizedAliyun ? { aliyunOss: normalizedAliyun } : {}),
  }
}

export async function saveTencentCosConfig(config: TencentCosConfig): Promise<CaptureSaveConfig> {
  const normalized = normalizeTencentCosConfig(config)
  const current = await readCaptureSaveConfig()
  const next: CaptureSaveConfig = { ...current, mode: "remote", provider: "tencent-cos", tencentCos: normalized, remote: normalized }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function saveAliyunOssConfig(config: AliyunOssConfig): Promise<CaptureSaveConfig> {
  const normalized = normalizeAliyunOssConfig(config)
  const current = await readCaptureSaveConfig()
  const next: CaptureSaveConfig = { ...current, mode: "remote", provider: "aliyun-oss", aliyunOss: normalized }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function setCaptureSaveMode(mode: CaptureSaveMode): Promise<CaptureSaveConfig> {
  const current = await readCaptureSaveConfig()
  if (mode === "remote" && !(current.provider === "aliyun-oss" ? current.aliyunOss : current.tencentCos)) throw new Error(`请先配置${current.provider === "aliyun-oss" ? "阿里云 OSS" : "腾讯云 COS"}。`)
  const next: CaptureSaveConfig = { ...current, mode }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function clearTencentCosConfig(): Promise<CaptureSaveConfig> {
  const current = await readCaptureSaveConfig()
  const { tencentCos: _tencentCos, remote: _remote, ...rest } = current
  const next: CaptureSaveConfig = { ...rest, mode: "local" }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function clearAliyunOssConfig(): Promise<CaptureSaveConfig> {
  const current = await readCaptureSaveConfig()
  const { aliyunOss: _aliyunOss, ...rest } = current
  const next: CaptureSaveConfig = { ...rest, mode: "local" }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export function activeRemoteConfig(config: CaptureSaveConfig): TencentCosConfig | AliyunOssConfig | undefined {
  return config.provider === "aliyun-oss" ? config.aliyunOss : config.tencentCos ?? config.remote
}
