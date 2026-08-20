export const REPORT_SCHEMA_VERSION = 1 as const
export const MAX_TARGETS = 10
export const MAX_CONSOLE_EVENTS = 100
export const MAX_NETWORK_EVENTS = 100

export type SessionStatus = "capturing" | "reviewing" | "exported" | "discarded"

export interface PageInfo {
  url: string
  title: string
  origin: string
  viewport: {
    width: number
    height: number
    devicePixelRatio: number
  }
  userAgent: string
  language: string
  capturedAt: string
}

export interface TargetRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ReactRuntimeHint {
  componentChain: string[]
  propsKeys: string[]
  available: boolean
  boundary?: string
}

export interface CssRuleEvidence {
  selector: string
  cssText: string
  styleSheetUrl?: string
}

export interface TargetAnnotation {
  actualResult: string
  expectedResult: string
}

export interface TargetSpacingEvidence {
  axis: "horizontal" | "vertical"
  distance: number
  from: string
  to: string
}

export interface SelectedTarget {
  id: string
  capturedAt: string
  rect: TargetRect
  tagName: string
  role?: string
  text?: string
  idAttribute?: string
  classNames: string[]
  testId?: string
  aria: Record<string, string>
  selector: string
  xpath: string
  ancestorPath: string
  dom: string
  computedStyle: Record<string, string>
  beforeStyle?: Record<string, string>
  afterStyle?: Record<string, string>
  cssRules: CssRuleEvidence[]
  selectionKind?: "element" | "spacing" | "text-line"
  spacing?: TargetSpacingEvidence
  react?: ReactRuntimeHint
  annotation?: TargetAnnotation
}

export interface ConsoleEvidence {
  id: string
  timestamp: string
  level: "log" | "info" | "warn" | "error" | "debug"
  message: string
  stack?: string
  truncated?: boolean
}

export interface NetworkEvidence {
  id: string
  timestamp: string
  method: string
  url: string
  type: "fetch" | "xhr" | "resource"
  resourceType?: string
  status?: number
  duration?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  requestBodyTruncated?: boolean
  responseBodyTruncated?: boolean
  error?: string
}

export interface CaptureLimitSummary {
  consoleDropped: number
  networkDropped: number
  targetLimitReached: boolean
}

export interface CaptureBoundary {
  code: string
  message: string
}

export interface ScreenshotEvidence {
  dataUrl?: string
  markedDataUrl?: string
  fileName?: string
  width?: number
  height?: number
  capturedAt?: string
}

export type CaptureMode = "screenshot" | "video"
export type CaptureSaveMode = "local" | "remote"
export type RecordingLifecycleStatus = "starting" | "recording" | "stopped" | "failed"

export interface TencentCosConfig {
  provider: "tencent-cos"
  bucket: string
  region: string
  secretId: string
  secretKey: string
  objectPrefix: string
  publicBaseUrl?: string
  configuredAt: string
  verifiedAt?: string
}

export interface RemoteArtifactLocation {
  provider: "tencent-cos"
  objectPrefix: string
  reportUrl: string
  recordingUrl?: string
  reportKey: string
  recordingKey?: string
  uploadedAt: string
}

export interface RecordingSessionState {
  resultId: string
  status: RecordingLifecycleStatus
  startedAt: string
  maxDurationMs: number
  stoppedAt?: string
  error?: string
}

export interface RecordingEvidence {
  resultId: string
  fileName: "capture.webm"
  mimeType: string
  startedAt: string
  durationMs: number
  sizeBytes: number
  width: 1280
  height: 720
  frameCount: number
  keyframes?: Array<{
    offsetMs: number
    reason: "start" | "page-change" | "marker" | "stop"
    label?: string
  }>
}

export type ArtifactKind = "markdown" | "json" | "capture" | "recording"
export type ArtifactAvailability = "available" | "missing" | "unknown"

export interface LocalArtifactLocation {
  rootName: string
  directoryName: string
  downloadRelativeDirectory?: string
  directoryPath: string
  reportMarkdownPath: string
  reportJsonPath: string
  capturePath: string
  recordingPath?: string
  downloadIds?: Partial<Record<ArtifactKind, number>>
  savedAt: string
}

export interface RootlineIssue {
  description: string
  expectedResult: string
  notes: string
}

export interface RootlineSession {
  schemaVersion: typeof REPORT_SCHEMA_VERSION
  id: string
  tabId: number
  windowId?: number
  startedAt: string
  updatedAt: string
  status: SessionStatus
  captureMode?: CaptureMode
  page: PageInfo
  issue: RootlineIssue
  targets: SelectedTarget[]
  console: ConsoleEvidence[]
  network: NetworkEvidence[]
  limits: CaptureLimitSummary
  boundaries: CaptureBoundary[]
  screenshot: ScreenshotEvidence
  saveMode?: CaptureSaveMode
  recordingState?: RecordingSessionState
  recording?: RecordingEvidence
  localArtifacts?: LocalArtifactLocation
  remoteArtifacts?: RemoteArtifactLocation
}

export interface RootlineReportV1 extends RootlineSession {
  schemaVersion: 1
  generatedAt: string
}

export interface SessionSummary {
  id: string
  tabId: number
  status: SessionStatus
  pageTitle: string
  pageUrl: string
  startedAt: string
  captureMode?: CaptureMode
  saveMode?: CaptureSaveMode
  targets: number
  consoleEvents: number
  errors: number
  networkEvents: number
  recordingState?: RecordingSessionState
  recording?: RecordingEvidence
  localArtifacts?: LocalArtifactLocation
  remoteArtifacts?: RemoteArtifactLocation
}
