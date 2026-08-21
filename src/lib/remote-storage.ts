import type { AliyunOssConfig, RemoteStorageConfig, TencentCosConfig } from "./types"
import { buildOssObjectUrl, deleteOssObject, joinOssKey, putOssObject, testAliyunOssConnection } from "./aliyun-oss"
import { buildCosObjectUrl, deleteCosObject, joinCosKey, putCosObject, testTencentCosConnection, type PutCosObjectOptions } from "./tencent-cos"

export type RemoteUploadProgress = { loaded: number; total: number; percent: number }
export type RemoteUploadOptions = { onProgress?: (progress: RemoteUploadProgress) => void; contentDisposition?: string }

export function isTencentConfig(config: RemoteStorageConfig): config is TencentCosConfig { return config.provider === "tencent-cos" }
export function isAliyunConfig(config: RemoteStorageConfig): config is AliyunOssConfig { return config.provider === "aliyun-oss" }

export function providerLabel(config: Pick<RemoteStorageConfig, "provider">): string {
  return config.provider === "aliyun-oss" ? "阿里云 OSS" : "腾讯云 COS"
}

export function buildRemoteObjectUrl(config: RemoteStorageConfig, key: string): string {
  return isAliyunConfig(config) ? buildOssObjectUrl(config, key) : buildCosObjectUrl(config, key)
}

export function joinRemoteKey(config: RemoteStorageConfig, prefix: string, ...segments: string[]): string {
  return isAliyunConfig(config) ? joinOssKey(prefix, ...segments) : joinCosKey(prefix, ...segments)
}

export async function putRemoteObject(config: RemoteStorageConfig, key: string, body: Blob, contentType: string, options: RemoteUploadOptions = {}): Promise<void> {
  if (isAliyunConfig(config)) return putOssObject(config, key, body, contentType, options)
  return putCosObject(config, key, body, contentType, options as PutCosObjectOptions)
}

export async function deleteRemoteObject(config: RemoteStorageConfig, key: string): Promise<void> {
  return isAliyunConfig(config) ? deleteOssObject(config, key) : deleteCosObject(config, key)
}

export async function testRemoteConnection(config: RemoteStorageConfig): Promise<RemoteStorageConfig> {
  return isAliyunConfig(config) ? testAliyunOssConnection(config) : testTencentCosConnection(config)
}
