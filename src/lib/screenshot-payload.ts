import type { RootlineSession } from "./types"

export function withoutScreenshotPayload<T extends RootlineSession>(value: T): T {
  const { dataUrl: _dataUrl, markedDataUrl: _markedDataUrl, ...screenshot } = value.screenshot
  if (!_dataUrl && !_markedDataUrl) return value
  return { ...value, screenshot } as T
}
