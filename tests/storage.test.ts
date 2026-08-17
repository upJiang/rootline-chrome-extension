import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanExpiredSessions, mutateSession, readSession, readSessionForTab, saveSession, SESSION_RETENTION_MS } from "../src/lib/storage"
import { makeSession } from "./helpers"

const store: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn(async (key: string | null) => {
          if (key === null) return { ...store }
          return { [key]: store[key] }
        }),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
        remove: vi.fn(async (key: string) => { delete store[key] }),
        clear: vi.fn(async () => { for (const key of Object.keys(store)) delete store[key] }),
      },
    },
  })
})

describe("session storage", () => {
  it("expires stale sessions and preserves fresh sessions", async () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z")
    await saveSession(makeSession({ id: "expired", tabId: 1, updatedAt: new Date(now - SESSION_RETENTION_MS - 1).toISOString() }))
    await saveSession(makeSession({ id: "fresh", tabId: 2, updatedAt: new Date(now - 1_000).toISOString() }))
    expect(await cleanExpiredSessions(now)).toBe(1)
    expect(await readSession("expired")).toBeNull()
    expect(await readSession("fresh")).not.toBeNull()
  })

  it("serializes concurrent mutations without dropping evidence", async () => {
    await saveSession(makeSession({ status: "capturing" }))
    await Promise.all([
      mutateSession("session-test", async (session) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        session.console.push({
          id: "console-1",
          timestamp: "2026-08-13T04:00:01.000Z",
          level: "error",
          message: "Unhandled rejection",
        })
      }),
      mutateSession("session-test", (session) => {
        session.network.push({
          id: "network-1",
          timestamp: "2026-08-13T04:00:02.000Z",
          method: "POST",
          url: "https://example.com/api",
          type: "fetch",
          status: 500,
        })
      }),
    ])

    const session = await readSession("session-test")
    expect(session?.console.map((item) => item.id)).toEqual(["console-1"])
    expect(session?.network.map((item) => item.id)).toEqual(["network-1"])
  })

  it("preserves the tab index when different sessions save concurrently", async () => {
    await Promise.all([
      saveSession(makeSession({ id: "session-one", tabId: 1 })),
      saveSession(makeSession({ id: "session-two", tabId: 2 })),
    ])

    expect((await readSessionForTab(1))?.id).toBe("session-one")
    expect((await readSessionForTab(2))?.id).toBe("session-two")
  })

  it("does not let an older report update the active session index", async () => {
    await saveSession(makeSession({ id: "previous", tabId: 1, status: "reviewing" }))
    await saveSession(makeSession({ id: "current", tabId: 1, status: "capturing" }))
    await mutateSession("previous", (session) => {
      session.issue.description = "补充旧报告说明"
    })
    expect((await readSessionForTab(1))?.id).toBe("current")
    expect((await readSession("previous"))?.issue.description).toBe("补充旧报告说明")
  })
})
