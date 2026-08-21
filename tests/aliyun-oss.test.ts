import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildOssObjectUrl, joinOssKey, putOssObject, testAliyunOssConnection } from "../src/lib/aliyun-oss"
import type { AliyunOssConfig } from "../src/lib/types"

const ossMocks = vi.hoisted(() => ({ delete: vi.fn(), put: vi.fn(), head: vi.fn() }))

vi.mock("ali-oss", () => ({
  default: class MockOss {
    delete = ossMocks.delete
    put = ossMocks.put
    head = ossMocks.head
  },
}))

const config: AliyunOssConfig = {
  provider: "aliyun-oss",
  bucket: "rootline-evidence",
  region: "cn-guangzhou",
  accessKeyId: "LTAI-test",
  accessKeySecret: "secret-test",
  objectPrefix: "rootline/",
  configuredAt: "2026-08-21T00:00:00.000Z",
}

describe("Aliyun OSS adapter", () => {
  beforeEach(() => {
    ossMocks.delete.mockReset().mockResolvedValue({})
    ossMocks.put.mockReset().mockResolvedValue({})
    ossMocks.head.mockReset().mockResolvedValue({})
    vi.unstubAllGlobals()
  })

  it("normalizes object keys and builds public URLs", () => {
    expect(joinOssKey("rootline/", "/capture 1/", "/report.html")).toBe("rootline/capture 1/report.html")
    expect(buildOssObjectUrl(config, "rootline/capture 1/report.html")).toBe("https://rootline-evidence.oss-cn-guangzhou.aliyuncs.com/rootline/capture%201/report.html")
  })

  it("sets inline metadata and reports upload progress", async () => {
    await putOssObject(config, "rootline/report.html", new Blob(["<html></html>"]), "text/html;charset=utf-8", { contentDisposition: 'inline; filename="rootline-report.html"' })
    expect(ossMocks.put).toHaveBeenCalledOnce()
    expect(ossMocks.put.mock.calls[0]?.[2]).toMatchObject({ mime: "text/html;charset=utf-8", headers: { "Content-Disposition": 'inline; filename="rootline-report.html"' } })
  })

  it("tests anonymous read and cleanup without capture content", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const nonce = String(url).match(/\.rootline-connection-test-([\w-]+)\.txt/)?.[1]
      return new Response(`rootline-connection-test:${nonce}`, { status: 200 })
    }))
    const verified = await testAliyunOssConnection(config)
    expect(verified.verifiedAt).toBeTruthy()
    expect(ossMocks.put).toHaveBeenCalledOnce()
    expect(ossMocks.delete).toHaveBeenCalledOnce()
  })

  it("explains public-read failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })))
    await expect(testAliyunOssConnection(config)).rejects.toThrow("公共读、私有写")
    expect(ossMocks.delete).toHaveBeenCalledOnce()
  })
})
