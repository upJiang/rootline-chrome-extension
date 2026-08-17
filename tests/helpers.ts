import type { RootlineSession } from "../src/lib/types"

export function makeSession(overrides: Partial<RootlineSession> = {}): RootlineSession {
  const now = "2026-08-13T04:00:00.000Z"
  return {
    schemaVersion: 1,
    id: "session-test",
    tabId: 1,
    windowId: 1,
    startedAt: now,
    updatedAt: now,
    status: "reviewing",
    page: {
      url: "https://example.com/app?token=secret-token",
      title: "Fixture",
      origin: "https://example.com",
      viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
      userAgent: "Chrome test",
      language: "zh-CN",
      capturedAt: now,
    },
    issue: { description: "按钮没有响应", expectedResult: "显示成功提示", notes: "" },
    targets: [],
    console: [],
    network: [],
    limits: { consoleDropped: 0, networkDropped: 0, targetLimitReached: false },
    boundaries: [{ code: "capture-window", message: "只采集开始后的事件。" }],
    screenshot: {},
    ...overrides,
  }
}
