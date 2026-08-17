import "fake-indexeddb/auto"
import { afterEach, describe, expect, it } from "vitest"
import { selectRecordingMimeType } from "../src/lib/recording-offscreen"
import {
  deleteRecordingResult,
  readRecordingResult,
  saveRecordingResult,
  type StoredRecordingResult,
} from "../src/lib/recording-result-store"
import {
  DEFAULT_RECORDING_MAX_DURATION_MS,
  MAX_RECORDING_MAX_DURATION_MS,
  MIN_RECORDING_MAX_DURATION_MS,
  normalizeRecordingMaxDurationMs,
} from "../src/lib/recording-settings"

const RESULT_ID = "recording-test-result"

afterEach(async () => {
  await deleteRecordingResult(RESULT_ID).catch(() => undefined)
})

describe("recording settings", () => {
  it("defaults, clamps and rounds the duration between one and ten minutes", () => {
    expect(normalizeRecordingMaxDurationMs(undefined)).toBe(DEFAULT_RECORDING_MAX_DURATION_MS)
    expect(normalizeRecordingMaxDurationMs(1)).toBe(MIN_RECORDING_MAX_DURATION_MS)
    expect(normalizeRecordingMaxDurationMs(90_000.4)).toBe(90_000)
    expect(normalizeRecordingMaxDurationMs(60 * 60_000)).toBe(MAX_RECORDING_MAX_DURATION_MS)
  })

  it("prefers VP9, then VP8, then generic WebM", () => {
    expect(selectRecordingMimeType(() => true)).toBe("video/webm;codecs=vp9")
    expect(selectRecordingMimeType((candidate) => candidate.includes("vp8"))).toBe("video/webm;codecs=vp8")
    expect(selectRecordingMimeType((candidate) => candidate === "video/webm")).toBe("video/webm")
    expect(selectRecordingMimeType(() => false)).toBeUndefined()
  })
})

describe("recording result store", () => {
  it("persists and removes the video blob and keyframes in IndexedDB", async () => {
    const result: StoredRecordingResult = {
      id: RESULT_ID,
      blob: new Blob(["rootline-video"], { type: "video/webm" }),
      createdAt: 1_700_000_000_000,
      durationMs: 4_200,
      frameQueue: [{
        id: "frame-1",
        capturedAt: 1_700_000_000_300,
        offsetMs: 300,
        dataUrl: "data:image/webp;base64,AA==",
        reason: "marker",
        label: "标注元素 1",
      }],
      mimeType: "video/webm",
      startedAt: 1_700_000_000_000,
    }

    await saveRecordingResult(result)
    const stored = await readRecordingResult(RESULT_ID)
    expect(stored?.blob.size).toBe(result.blob.size)
    expect(stored?.frameQueue).toEqual(result.frameQueue)

    await deleteRecordingResult(RESULT_ID)
    expect(await readRecordingResult(RESULT_ID)).toBeNull()
  })
})
