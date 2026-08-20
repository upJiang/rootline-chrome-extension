import { z } from "zod"
import type { CaptureSaveMode, TencentCosConfig } from "./types"

const STORAGE_KEY = "rootline:capture-save-config"

export interface CaptureSaveConfig {
  mode: CaptureSaveMode
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

export async function readCaptureSaveConfig(): Promise<CaptureSaveConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY] as CaptureSaveConfig | undefined
  if (!value) return { mode: "local" }
  const mode: CaptureSaveMode = value.mode === "remote" ? "remote" : "local"
  if (!value.remote) return { mode }
  try {
    return { mode, remote: normalizeTencentCosConfig(value.remote) }
  } catch {
    return { mode: "local" }
  }
}

export async function saveTencentCosConfig(config: TencentCosConfig): Promise<CaptureSaveConfig> {
  const normalized = normalizeTencentCosConfig(config)
  const next: CaptureSaveConfig = { mode: "remote", remote: normalized }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function setCaptureSaveMode(mode: CaptureSaveMode): Promise<CaptureSaveConfig> {
  const current = await readCaptureSaveConfig()
  if (mode === "remote" && !current.remote) throw new Error("请先配置腾讯云 COS。")
  const next: CaptureSaveConfig = { ...current, mode }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}

export async function clearTencentCosConfig(): Promise<CaptureSaveConfig> {
  const next: CaptureSaveConfig = { mode: "local" }
  await chrome.storage.local.set({ [STORAGE_KEY]: next })
  return next
}
