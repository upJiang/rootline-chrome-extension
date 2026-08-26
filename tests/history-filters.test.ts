import { describe, expect, it } from "vitest"
import { dateRangeForPreset, historyDateRangeError, historyPageCount, HISTORY_PAGE_SIZE, matchesHistoryDateRange } from "../entrypoints/capture-history/history-filters"
import { createReport } from "../src/lib/report"
import type { CaptureHistoryItem } from "../src/lib/local-artifacts"
import { makeSession } from "./helpers"

function readyItem(generatedAt: string): CaptureHistoryItem {
  return {
    directoryName: `capture-${generatedAt}`,
    state: "ready",
    report: { ...createReport(makeSession()), generatedAt },
    hasCapture: true,
    hasRecording: false,
    hasMarkdown: true,
    captureState: "available",
    recordingState: "missing",
    markdownState: "available",
    jsonState: "available",
  }
}

describe("capture history date filters", () => {
  it("keeps history pagination at ten records per page", () => {
    expect(HISTORY_PAGE_SIZE).toBe(10)
    expect(historyPageCount(0)).toBe(1)
    expect(historyPageCount(10)).toBe(1)
    expect(historyPageCount(11)).toBe(2)
    expect(historyPageCount(25)).toBe(3)
  })

  it("builds inclusive local calendar ranges for presets", () => {
    const now = new Date(2026, 7, 25, 18, 30)
    expect(dateRangeForPreset("all", now)).toEqual({ from: "", to: "" })
    expect(dateRangeForPreset("today", now)).toEqual({ from: "2026-08-25", to: "2026-08-25" })
    expect(dateRangeForPreset("7d", now)).toEqual({ from: "2026-08-19", to: "2026-08-25" })
    expect(dateRangeForPreset("30d", now)).toEqual({ from: "2026-07-27", to: "2026-08-25" })
  })

  it("includes records through the end of the selected end date", () => {
    const endOfDay = new Date(2026, 7, 25, 23, 59, 59, 999).toISOString()
    const nextDay = new Date(2026, 7, 26, 0, 0, 0, 0).toISOString()
    expect(matchesHistoryDateRange(readyItem(endOfDay), { from: "2026-08-25", to: "2026-08-25" })).toBe(true)
    expect(matchesHistoryDateRange(readyItem(nextDay), { from: "2026-08-25", to: "2026-08-25" })).toBe(false)
  })

  it("keeps invalid records without a date only when no date filter is active", () => {
    const invalid: CaptureHistoryItem = {
      directoryName: "invalid-record",
      state: "invalid",
      hasCapture: false,
      hasRecording: false,
      hasMarkdown: false,
      captureState: "missing",
      recordingState: "missing",
      markdownState: "missing",
      jsonState: "missing",
    }
    expect(matchesHistoryDateRange(invalid, { from: "", to: "" })).toBe(true)
    expect(matchesHistoryDateRange(invalid, { from: "2026-08-25", to: "2026-08-25" })).toBe(false)
  })

  it("rejects invalid and reversed custom ranges", () => {
    expect(historyDateRangeError({ from: "2026-02-31", to: "2026-03-01" })).toBe("请输入有效的日期。")
    expect(historyDateRangeError({ from: "2026-08-26", to: "2026-08-25" })).toBe("开始日期不能晚于结束日期。")
    expect(matchesHistoryDateRange(readyItem("2026-08-25T12:00:00.000Z"), { from: "2026-08-26", to: "2026-08-25" })).toBe(false)
  })
})
