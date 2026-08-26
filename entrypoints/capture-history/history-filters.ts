import type { CaptureHistoryItem } from "../../src/lib/local-artifacts"

export type HistoryDatePreset = "all" | "today" | "7d" | "30d" | "custom"
export type HistoryDateRange = {
  preset: HistoryDatePreset
  from: string
  to: string
}

export const HISTORY_PAGE_SIZE = 10

export function historyPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / HISTORY_PAGE_SIZE))
}

function localDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dateValueBoundary(value: string, endOfDay: boolean): number | null {
  if (!value) return null
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number)
  if (!parts || parts.length !== 3 || !parts.every(Number.isFinite)) return null
  const [year, month, day] = parts as [number, number, number]
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date.getTime()
}

export function dateRangeForPreset(preset: HistoryDatePreset, now = new Date()): { from: string; to: string } {
  if (preset === "all" || preset === "custom") return { from: "", to: "" }
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (preset === "today") {
    const value = localDateValue(today)
    return { from: value, to: value }
  }
  const from = new Date(today)
  from.setDate(from.getDate() - (preset === "7d" ? 6 : 29))
  return { from: localDateValue(from), to: localDateValue(today) }
}

export function historyDateRangeError(range: Pick<HistoryDateRange, "from" | "to">): string | null {
  const start = dateValueBoundary(range.from, false)
  const end = dateValueBoundary(range.to, true)
  if ((range.from && start === null) || (range.to && end === null)) return "请输入有效的日期。"
  if (start !== null && end !== null && start > end) return "开始日期不能晚于结束日期。"
  return null
}

export function matchesHistoryDateRange(item: CaptureHistoryItem, range: Pick<HistoryDateRange, "from" | "to">): boolean {
  if (!range.from && !range.to) return true
  const timestamp = item.report?.generatedAt ? new Date(item.report.generatedAt).getTime() : Number.NaN
  if (!Number.isFinite(timestamp)) return false
  const start = dateValueBoundary(range.from, false)
  const end = dateValueBoundary(range.to, true)
  if (historyDateRangeError(range)) return false
  return (start === null || timestamp >= start) && (end === null || timestamp <= end)
}
