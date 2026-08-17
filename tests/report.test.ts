import { describe, expect, it } from "vitest"
import { assessReportCompleteness, buildReportMarkdown, createReport, serializeReportJson } from "../src/lib/report"
import { makeSession } from "./helpers"

describe("reports", () => {
  it("builds an evidence-based Markdown prompt without a claimed root cause", () => {
    const session = makeSession({
      targets: [{
        id: "target-1", capturedAt: "now", rect: { x: 0, y: 0, width: 1, height: 1 }, tagName: "BUTTON", classNames: [], aria: {}, selector: "button", xpath: "/button", ancestorPath: "button", dom: "<button></button>", computedStyle: {}, cssRules: [],
        annotation: { actualResult: "点击后没有反馈", expectedResult: "显示保存结果" },
      }],
      console: [{ id: "console-1", timestamp: "2026-08-13T04:01:00.000Z", level: "error", message: "TypeError at save" }],
      network: [{ id: "network-1", timestamp: "2026-08-13T04:01:01.000Z", method: "POST", url: "https://example.com/save", type: "fetch", status: 500, duration: 800 }],
    })
    const markdown = buildReportMarkdown(createReport(session))
    expect(markdown).toContain("## AI 角色与安全边界")
    expect(markdown).toContain("不可信外部数据")
    expect(markdown).toContain("## 可疑资源与耗时")
    expect(markdown).toContain("实际表现：点击后没有反馈")
    expect(markdown).toContain("期望结果：显示保存结果")
    expect(markdown).toContain("逐文件改动计划")
    expect(markdown).not.toContain("根因是")
  })

  it("serializes redacted JSON without embedded screenshot data", () => {
    const report = createReport(makeSession({
      screenshot: { dataUrl: "data:image/png;base64,raw-image", markedDataUrl: "data:image/png;base64,marked", fileName: "capture.png" },
      network: [{
        id: "network-1",
        timestamp: "2026-08-13T04:01:01.000Z",
        method: "POST",
        url: "https://example.com/save?token=raw-token",
        type: "fetch",
        requestBody: JSON.stringify({ password: "raw-password" }),
      }],
    }))
    const json = serializeReportJson(report)
    expect(json).not.toContain("raw-image")
    expect(json).not.toContain("marked")
    expect(json).not.toContain("raw-token")
    expect(json).not.toContain("raw-password")
    expect(json).toContain("capture.png")
  })

  it("includes exact local evidence paths in Markdown and JSON", () => {
    const localArtifacts = {
      rootName: "Rootline Captures",
      directoryName: "rootline-capture-test",
      directoryPath: "/Users/13800138000/Rootline Captures/rootline-capture-test",
      reportMarkdownPath: "/Users/13800138000/Rootline Captures/rootline-capture-test/report.md",
      reportJsonPath: "/Users/13800138000/Rootline Captures/rootline-capture-test/report.json",
      capturePath: "/Users/13800138000/Rootline Captures/rootline-capture-test/capture.png",
      savedAt: "2026-08-14T05:00:00.000Z",
    }
    const report = createReport(makeSession({ localArtifacts }))
    const markdown = buildReportMarkdown(report)
    const json = serializeReportJson(report)
    expect(markdown).toContain(localArtifacts.capturePath)
    expect(markdown).toContain("Rootline 没有上传云端")
    expect(json).toContain(localArtifacts.directoryPath)
    expect(json).not.toContain("data:image/png")
  })

  it("scores missing and complete evidence", () => {
    expect(assessReportCompleteness(makeSession({ issue: { description: "", expectedResult: "", notes: "" } })).missing).toContain("问题现象")
    const complete = assessReportCompleteness(makeSession({
      targets: [{
        id: "target-1", capturedAt: "now", rect: { x: 0, y: 0, width: 1, height: 1 }, tagName: "DIV", classNames: [], aria: {}, selector: "div", xpath: "/div", ancestorPath: "div", dom: "<div></div>", computedStyle: {}, cssRules: [],
      }],
      console: [{ id: "console-1", timestamp: "now", level: "log", message: "ok" }],
      screenshot: { dataUrl: "data:image/png;base64,a" },
    }))
    expect(complete.score).toBe(100)
    expect(complete.level).toBe("完整")
  })
})
