export function formatElapsedTime(startedAt: string, now = Date.now()): string {
  const started = Date.parse(startedAt)
  const totalSeconds = Number.isFinite(started)
    ? Math.max(0, Math.floor((now - started) / 1_000))
    : 0
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const padded = (value: number) => String(value).padStart(2, "0")
  return hours > 0
    ? `${padded(hours)}:${padded(minutes)}:${padded(seconds)}`
    : `${padded(minutes)}:${padded(seconds)}`
}

function padded(value: number): string {
  return String(value).padStart(2, "0")
}

/** Format a local timestamp for a portable, human-readable capture directory name. */
export function formatCaptureDirectoryTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return "unknown-date_unknown-time"
  return `${date.getFullYear()}-${padded(date.getMonth() + 1)}-${padded(date.getDate())}_${padded(date.getHours())}-${padded(date.getMinutes())}-${padded(date.getSeconds())}`
}

export function buildCaptureDirectoryName(value: Date | string, suffix?: string): string {
  return `rootline-capture-${formatCaptureDirectoryTimestamp(value)}${suffix ? `-${suffix}` : ""}`
}
