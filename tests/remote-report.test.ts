import { describe, expect, it } from "vitest"
import { buildRemoteReportHtml } from "../src/lib/remote-report"
import { buildRemoteAiContext, createReport } from "../src/lib/report"
import { makeSession } from "./helpers"

describe("remote report", () => {
  it("embeds the screenshot, links the recording, and escapes untrusted evidence", () => {
    const report = createReport(makeSession({
      page: { ...makeSession().page, title: "<script>alert(1)</script>" },
      issue: { description: "<img src=x onerror=alert(1)>", expectedResult: "显示结果", notes: "" },
      remoteArtifacts: {
        provider: "tencent-cos",
        objectPrefix: "rootline/rootline-capture-test",
        reportKey: "rootline/rootline-capture-test/report.html",
        reportUrl: "https://rootline-1250000000.cos.ap-guangzhou.myqcloud.com/rootline/rootline-capture-test/report.html",
        recordingKey: "rootline/rootline-capture-test/capture.webm",
        recordingUrl: "https://rootline-1250000000.cos.ap-guangzhou.myqcloud.com/rootline/rootline-capture-test/capture.webm",
        uploadedAt: new Date().toISOString(),
      },
    }))
    const html = buildRemoteReportHtml(report, "data:image/png;base64,AAAA")
    expect(html).toContain("data:image/png;base64,AAAA")
    expect(html).toContain("capture.webm")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("Content-Security-Policy")
  })

  it("creates a stable AI context without credentials or upload instructions", () => {
    const context = buildRemoteAiContext({
      provider: "tencent-cos",
      objectPrefix: "rootline/rootline-capture-test",
      reportKey: "rootline/rootline-capture-test/report.html",
      reportUrl: "https://example.com/report.html",
      uploadedAt: new Date().toISOString(),
    })
    expect(context).toContain("https://example.com/report.html")
    expect(context).toContain("直接打开并读取")
    expect(context).not.toContain("SecretKey")
  })

  it("accepts a WebP screenshot without allowing arbitrary data URLs", () => {
    const report = createReport(makeSession())
    expect(buildRemoteReportHtml(report, "data:image/webp;base64,AAAA")).toContain("data:image/webp;base64,AAAA")
    expect(buildRemoteReportHtml(report, "data:image/svg+xml;base64,AAAA")).not.toContain("data:image/svg+xml")
  })
})
