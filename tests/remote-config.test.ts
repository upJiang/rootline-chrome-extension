import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearTencentCosConfig, normalizeTencentCosConfig, readCaptureSaveConfig, saveTencentCosConfig, setCaptureSaveMode } from "../src/lib/remote-config"

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
})

