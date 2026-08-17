import type { RecordingEvidence } from "./types"

export const RECORDING_ACTIVE_STORAGE_KEY = "rootline:active-recording"
export const RECORDING_MAX_DURATION_ALARM = "rootline-recording-max-duration"

export interface ActiveRecordingRuntime {
  sessionId: string
  tabId: number
  pageTitle: string
  startedAt: string
  maxDurationMs: number
}

export type RecordingControlMessage =
  | { type: "ROOTLINE_OFFSCREEN_START_RECORDING"; sessionId: string; maxDurationMs: number }
  | { type: "ROOTLINE_OFFSCREEN_STOP_RECORDING"; sessionId: string; discard?: boolean; reason?: "manual" | "timeout" | "sharing-ended" }
  | { type: "ROOTLINE_OFFSCREEN_MARK_FRAME"; sessionId: string; label: string }
  | { type: "ROOTLINE_OFFSCREEN_RECORDING_STATUS"; sessionId: string }

export interface OffscreenRecordingResult {
  recording?: RecordingEvidence
  stopped: boolean
}

export interface OffscreenRecordingEndedMessage {
  type: "ROOTLINE_OFFSCREEN_RECORDING_ENDED"
  sessionId: string
  recording?: RecordingEvidence
  error?: string
}

export function isRecordingControlMessage(value: unknown): value is RecordingControlMessage {
  const type = (value as { type?: unknown } | null)?.type
  return type === "ROOTLINE_OFFSCREEN_START_RECORDING"
    || type === "ROOTLINE_OFFSCREEN_STOP_RECORDING"
    || type === "ROOTLINE_OFFSCREEN_MARK_FRAME"
    || type === "ROOTLINE_OFFSCREEN_RECORDING_STATUS"
}

export function isOffscreenRecordingEndedMessage(value: unknown): value is OffscreenRecordingEndedMessage {
  return (value as { type?: unknown } | null)?.type === "ROOTLINE_OFFSCREEN_RECORDING_ENDED"
}
