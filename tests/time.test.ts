import { describe, expect, it } from "vitest"
import { buildCaptureDirectoryName, formatCaptureDirectoryTimestamp, formatElapsedTime } from "../src/lib/time"

describe("formatElapsedTime", () => {
  const startedAt = "2026-08-13T00:00:00.000Z"
  const started = Date.parse(startedAt)

  it("formats seconds", () => {
    expect(formatElapsedTime(startedAt, started + 12_000)).toBe("00:12")
  })

  it("formats minutes", () => {
    expect(formatElapsedTime(startedAt, started + 12 * 60_000 + 34_000)).toBe("12:34")
  })

  it("formats hours", () => {
    expect(formatElapsedTime(startedAt, started + 2 * 3_600_000 + 3 * 60_000 + 4_000)).toBe("02:03:04")
  })

  it("falls back safely for invalid timestamps", () => {
    expect(formatElapsedTime("invalid", started)).toBe("00:00")
  })
})

describe("capture directory names", () => {
  it("uses a readable local date and time without path-hostile punctuation", () => {
    const localDate = new Date(2026, 7, 17, 12, 15, 59)
    expect(formatCaptureDirectoryTimestamp(localDate)).toBe("2026-08-17_12-15-59")
    expect(buildCaptureDirectoryName(localDate, "f08330dd")).toBe("rootline-capture-2026-08-17_12-15-59-f08330dd")
  })
})
