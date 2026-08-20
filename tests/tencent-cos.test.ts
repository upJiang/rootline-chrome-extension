import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildCosObjectUrl, joinCosKey, testTencentCosConnection } from "../src/lib/tencent-cos"
import type { TencentCosConfig } from "../src/lib/types"

const cosMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  putObject: vi.fn(),
}))

vi.mock("cos-js-sdk-v5", () => ({
  default: class MockCos {
    deleteObject = cosMocks.deleteObject
    putObject = cosMocks.putObject
  },
}))

const config: TencentCosConfig = {
  provider: "tencent-cos",
  bucket: "rootline-1250000000",
  region: "ap-guangzhou",
  secretId: "AKID-test",
  secretKey: "secret-test",
  objectPrefix: "rootline/",
  configuredAt: "2026-08-20T00:00:00.000Z",
}

describe("Tencent COS paths", () => {
  beforeEach(() => {
    cosMocks.deleteObject.mockReset().mockResolvedValue({})
    cosMocks.putObject.mockReset().mockResolvedValue({})
    vi.unstubAllGlobals()
  })

  it("joins prefixes without traversal or duplicate slashes", () => {
    expect(joinCosKey("rootline/", "/capture-1/", "/report.html")).toBe("rootline/capture-1/report.html")
  })

  it("builds an encoded public object URL", () => {
    expect(buildCosObjectUrl(config, "rootline/capture 1/report.html")).toBe("https://rootline-1250000000.cos.ap-guangzhou.myqcloud.com/rootline/capture%201/report.html")
  })

  it("tests upload, anonymous read, and cleanup without using capture content", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (url) => {
      const match = String(url).match(/\.rootline-connection-test-([\w-]+)\.txt/)
      const nonce = match?.[1]
      return new Response(`rootline-connection-test:${nonce}`, { status: 200 })
    })

    const verified = await testTencentCosConnection(config)

    expect(verified.verifiedAt).toBeTruthy()
    expect(cosMocks.putObject).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(cosMocks.deleteObject).toHaveBeenCalledOnce()
    const uploaded = cosMocks.putObject.mock.calls[0]?.[0] as { Body?: string; Key?: string }
    expect(uploaded.Key).toContain(".rootline-connection-test-")
    expect(uploaded.Body).toMatch(/^rootline-connection-test:/)
  })

  it("explains public-read failures and still removes the test object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })))

    await expect(testTencentCosConnection(config)).rejects.toThrow("公有读、私有写")
    expect(cosMocks.deleteObject).toHaveBeenCalledOnce()
  })

  it("fails when the temporary object cannot be deleted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const match = String(url).match(/\.rootline-connection-test-([\w-]+)\.txt/)
      return new Response(`rootline-connection-test:${match?.[1]}`, { status: 200 })
    }))
    cosMocks.deleteObject.mockRejectedValueOnce({ statusCode: 403 })

    await expect(testTencentCosConnection(config)).rejects.toThrow("删除失败")
  })
})
