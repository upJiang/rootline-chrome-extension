import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildCosObjectUrl, joinCosKey, putCosObject, testTencentCosConnection } from "../src/lib/tencent-cos"
import type { TencentCosConfig } from "../src/lib/types"

const cosMocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  headObject: vi.fn(),
  putObject: vi.fn(),
}))

vi.mock("cos-js-sdk-v5", () => ({
  default: class MockCos {
    deleteObject = cosMocks.deleteObject
    headObject = cosMocks.headObject
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
    cosMocks.headObject.mockReset().mockRejectedValue({ statusCode: 404 })
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
    const uploaded = cosMocks.putObject.mock.calls[0]?.[0] as { Body?: Blob; Key?: string; ContentDisposition?: string }
    expect(uploaded.Key).toContain(".rootline-connection-test-")
    expect(uploaded.Body).toBeInstanceOf(Blob)
    expect(uploaded.ContentDisposition).toBeUndefined()
    await expect(uploaded.Body?.text()).resolves.toMatch(/^rootline-connection-test:/)
  })

  it("explains public-read failures and still removes the test object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("forbidden", { status: 403 })))

    await expect(testTencentCosConnection(config)).rejects.toThrow("公有读、私有写")
    expect(cosMocks.deleteObject).toHaveBeenCalledOnce()
  })

  it("explains forced-download buckets before a capture is uploaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const match = String(url).match(/\.rootline-connection-test-([\w-]+)\.txt/)
      return new Response(`rootline-connection-test:${match?.[1]}`, {
        status: 200,
        headers: { "content-disposition": "attachment" },
      })
    }))

    await expect(testTencentCosConnection(config)).rejects.toThrow("强制下载")
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

  it("does not describe a signature mismatch as an invalid credential", async () => {
    cosMocks.putObject.mockRejectedValueOnce({
      code: "SignatureDoesNotMatch",
      statusCode: 403,
      requestId: "NjQ-safe-request-id==",
    })

    let capturedError: Error | null = null
    try {
      await testTencentCosConnection(config)
    } catch (error) {
      capturedError = error as Error
    }
    expect(capturedError?.message).toContain("请求签名不匹配")
    expect(capturedError?.message).not.toContain("凭证无效")
    expect(capturedError?.message).toContain("requestId=NjQ-safe-request-id==")
  })

  it("accepts an upload whose final response failed when HEAD confirms the new object", async () => {
    cosMocks.putObject.mockRejectedValueOnce({ code: "SignatureDoesNotMatch", statusCode: 403 })
    cosMocks.headObject.mockResolvedValueOnce({
      headers: {
        "content-length": String(new Blob(["payload"]).size),
        "last-modified": new Date().toUTCString(),
      },
    })

    await expect(putCosObject(config, "rootline/report.html", new Blob(["payload"]), "text/html")).resolves.toBeUndefined()
  })

  it("marks browser-openable report and recording objects as inline", async () => {
    await putCosObject(config, "rootline/report.html", new Blob(["<html></html>"]), "text/html;charset=utf-8", {
      contentDisposition: 'inline; filename="rootline-report.html"',
    })
    await putCosObject(config, "rootline/capture.webm", new Blob(["video"]), "video/webm", {
      contentDisposition: 'inline; filename="capture.webm"',
    })

    expect(cosMocks.putObject.mock.calls[0]?.[0]).toMatchObject({
      ContentDisposition: 'inline; filename="rootline-report.html"',
    })
    expect(cosMocks.putObject.mock.calls[1]?.[0]).toMatchObject({
      ContentDisposition: 'inline; filename="capture.webm"',
    })
  })
})
