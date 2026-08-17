export const DEFAULT_RECORDING_MAX_DURATION_MS = 60_000
export const MIN_RECORDING_MAX_DURATION_MS = 60_000
export const MAX_RECORDING_MAX_DURATION_MS = 10 * 60_000

export function normalizeRecordingMaxDurationMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_RECORDING_MAX_DURATION_MS
  return Math.min(MAX_RECORDING_MAX_DURATION_MS, Math.max(MIN_RECORDING_MAX_DURATION_MS, Math.round(numeric)))
}
