import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearTencentCosConfig, normalizeAliyunOssConfig, normalizeTencentCosConfig, readCaptureSaveConfig, saveAliyunOssConfig, saveTencentCosConfig, setCaptureSaveMode } from "../src/lib/remote-config"

const localStore: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(localStore)) delete localStore[key]
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localStore[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(localStore, values)),
      },
    },
  })
})

describe("remote save config", () => {
  it("normalizes COS values and defaults the prefix", () => {
    const config = normalizeTencentCosConfig({
      bucket: "Rootline-1250000000",
      region: "AP-GUANGZHOU",
      secretId: "AKID-test-value",
      secretKey: "secret-value",
      objectPrefix: "",
    })
    expect(config.bucket).toBe("rootline-1250000000")
    expect(config.region).toBe("ap-guangzhou")
    expect(config.objectPrefix).toBe("rootline/")
  })

  it("rejects traversal in object prefixes", () => {
    expect(() => normalizeTencentCosConfig({
      bucket: "rootline-1250000000",
      region: "ap-guangzhou",
      secretId: "AKID-test-value",
      secretKey: "secret-value",
      objectPrefix: "rootline/../private",
    })).toThrow("无效目录段")
  })

  it("stores credentials only in extension local storage and resets to local mode when cleared", async () => {
    const config = normalizeTencentCosConfig({
      bucket: "rootline-1250000000",
      region: "ap-guangzhou",
      secretId: "AKID-test-value",
      secretKey: "secret-value",
      objectPrefix: "rootline/",
    })
    await saveTencentCosConfig(config)
    expect((await readCaptureSaveConfig()).mode).toBe("remote")
    expect((await setCaptureSaveMode("local")).mode).toBe("local")
    expect((await clearTencentCosConfig()).mode).toBe("local")
    expect((await readCaptureSaveConfig()).remote).toBeUndefined()
  })

  it("migrates legacy Tencent remote config and preserves it when Aliyun is saved", async () => {
    const tencent = normalizeTencentCosConfig({ bucket: "rootline-1250000000", region: "ap-guangzhou", secretId: "AKID-test-value", secretKey: "secret-value", objectPrefix: "rootline/" })
    localStore["rootline:capture-save-config"] = { mode: "remote", remote: tencent }
    const migrated = await readCaptureSaveConfig()
    expect(migrated.provider).toBe("tencent-cos")
    expect(migrated.tencentCos?.bucket).toBe("rootline-1250000000")
    const aliyun = normalizeAliyunOssConfig({ bucket: "rootline-evidence", region: "cn-guangzhou", accessKeyId: "LTAI-test-value", accessKeySecret: "secret-value", objectPrefix: "rootline/" })
    await saveAliyunOssConfig(aliyun)
    const saved = await readCaptureSaveConfig()
    expect(saved.provider).toBe("aliyun-oss")
    expect(saved.aliyunOss?.bucket).toBe("rootline-evidence")
    expect(saved.tencentCos?.bucket).toBe("rootline-1250000000")
  })
})
