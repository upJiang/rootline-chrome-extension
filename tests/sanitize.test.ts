import { describe, expect, it } from "vitest"
import { sanitizeNetworkEvidence, sanitizeTargetEvidence } from "../src/lib/capture/sanitize"

describe("untrusted runtime evidence", () => {
  it("redacts forged network messages before storage", () => {
    const result = sanitizeNetworkEvidence({
      id: "network-1",
      timestamp: "2026-08-13T04:00:00.000Z",
      method: "post",
      url: "https://example.com/api?access_token=raw-token",
      type: "fetch",
      requestHeaders: { Authorization: "Bearer raw-auth", Cookie: "sid=raw-cookie" },
      responseHeaders: { "Set-Cookie": "session=raw-session" },
      requestBody: JSON.stringify({ password: "raw-password", safe: "yes" }),
      responseBody: JSON.stringify({ refresh_token: "raw-refresh", status: "ok" }),
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain("raw-token")
    expect(text).not.toContain("raw-auth")
    expect(text).not.toContain("raw-cookie")
    expect(text).not.toContain("raw-session")
    expect(text).not.toContain("raw-password")
    expect(text).not.toContain("raw-refresh")
    expect(text).toContain("yes")
    expect(text).toContain("ok")
  })

  it("limits forged DOM, CSS and React metadata", () => {
    const result = sanitizeTargetEvidence({
      id: "target-1",
      capturedAt: "2026-08-13T04:00:00.000Z",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      tagName: "BUTTON",
      classNames: Array.from({ length: 45 }, (_, index) => `class-${index}`),
      aria: { "aria-label": "password=raw-password" },
      selector: "#save",
      xpath: "/html/body/button",
      ancestorPath: "html > body > button",
      dom: `<button data-token="raw-token">${"x".repeat(30_000)}</button>`,
      computedStyle: { color: "red" },
      cssRules: Array.from({ length: 30 }, () => ({ selector: ".save", cssText: "color:red" })),
      annotation: {
        actualResult: `password=raw-annotation-password ${"a".repeat(400)}`,
        expectedResult: "token=raw-annotation-token should be hidden",
      },
      react: { available: true, componentChain: ["SaveButton"], propsKeys: Array.from({ length: 50 }, (_, index) => `prop${index}`) },
    })
    expect(result.classNames).toHaveLength(30)
    expect(result.cssRules).toHaveLength(20)
    expect(result.react?.propsKeys).toHaveLength(40)
    expect(result.dom.length).toBeLessThan(25_000)
    expect(result.annotation?.actualResult.length).toBeLessThanOrEqual(300)
    expect(JSON.stringify(result)).not.toContain("raw-token")
    expect(JSON.stringify(result)).not.toContain("raw-password")
    expect(JSON.stringify(result)).not.toContain("raw-annotation-token")
    expect(JSON.stringify(result)).not.toContain("raw-annotation-password")
  })
})
