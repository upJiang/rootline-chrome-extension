import type {
  ConsoleEvidence,
  NetworkEvidence,
  PageInfo,
  RootlineIssue,
  RootlineSession,
  CaptureMode,
  CaptureSaveMode,
  RecordingEvidence,
  RecordingSessionState,
  SelectedTarget,
  SessionSummary,
  TencentCosConfig,
} from "./types"
import type { CaptureSaveConfig } from "./remote-config"

export type RemoteSaveStage =
  | "rendering-capture"
  | "uploading-recording"
  | "uploading-report"
  | "saving-history"

export interface RemoteSaveProgress {
  stage: RemoteSaveStage
  loadedBytes?: number
  totalBytes?: number
  percent?: number
}

export type ExtensionRequest =
  | { type: "GET_ACTIVE_STATE"; tabId?: number }
  | { type: "GET_SESSION"; sessionId: string }
  | { type: "GET_SAVE_CONFIG" }
  | { type: "SET_SAVE_MODE"; mode: CaptureSaveMode }
  | { type: "SAVE_COS_CONFIG"; config: TencentCosConfig }
  | { type: "TEST_COS_CONFIG"; config: TencentCosConfig }
  | { type: "CLEAR_COS_CONFIG" }
  | { type: "START_SESSION"; tabId: number; captureMode?: CaptureMode; maxDurationMs?: number }
  | { type: "STOP_RECORDING"; sessionId: string }
  | { type: "REANNOTATE_SESSION"; sessionId: string }
  | { type: "FINISH_SESSION"; sessionId: string }
  | { type: "DISCARD_SESSION"; sessionId: string }
  | { type: "UPDATE_ISSUE"; sessionId: string; issue: RootlineIssue }
  | { type: "MARK_EXPORTED"; sessionId: string }
  | { type: "RUNTIME_READY"; sessionId: string; page: PageInfo }
  | { type: "RUNTIME_HEARTBEAT"; sessionId: string }
  | { type: "RUNTIME_EVENTS"; sessionId: string; console: ConsoleEvidence[]; network: NetworkEvidence[] }
  | { type: "TARGET_SELECTED"; sessionId: string; target: SelectedTarget }
  | { type: "TARGET_REMOVED"; sessionId: string; targetId: string }
  | { type: "FINISH_FROM_PAGE"; sessionId: string }
  | { type: "GET_AI_CONTEXT_FROM_PAGE"; sessionId: string }
  | { type: "EXPORT_FROM_PAGE"; sessionId: string; captureDataUrl?: string }
  | { type: "OPEN_REVIEW_FROM_PAGE"; sessionId: string }
  | { type: "OPEN_REMOTE_REPORT_FROM_PAGE"; sessionId: string }
  | { type: "OPEN_HISTORY_FROM_PAGE" }

export interface OffscreenWriteRequest {
  type: "OFFSCREEN_WRITE_SESSION"
  session: RootlineSession
}

export interface OffscreenWriteRemoteRequest {
  type: "OFFSCREEN_WRITE_REMOTE_SESSION"
  session: RootlineSession
  config: TencentCosConfig
}

export interface OffscreenTestCosRequest {
  type: "OFFSCREEN_TEST_COS"
  config: TencentCosConfig
}

export interface OffscreenReexportRequest {
  type: "OFFSCREEN_REEXPORT_RECORD"
  directoryName: string
}

export interface OffscreenReexportRemoteRequest {
  type: "OFFSCREEN_REEXPORT_REMOTE_RECORD"
  directoryName: string
}

export interface OffscreenDownloadRequest {
  type: "OFFSCREEN_DOWNLOAD_ARTIFACT"
  filename: string
  url: string
}

export interface OffscreenRemoteSaveProgressMessage {
  type: "OFFSCREEN_REMOTE_SAVE_PROGRESS"
  sessionId: string
  progress: RemoteSaveProgress
}

export type TabRuntimeRequest =
  | {
      type: "ROOTLINE_START"
      sessionId: string
      startedAt: string
      targets: SelectedTarget[]
      captureMode?: CaptureMode
      recordingState?: RecordingSessionState
      recording?: RecordingEvidence
    }
  | { type: "ROOTLINE_SET_SELECTION"; enabled: boolean }
  | { type: "ROOTLINE_CAPTURE_SNAPSHOT" }
  | { type: "ROOTLINE_PREPARE_FINISH" }
  | { type: "ROOTLINE_SHOW_FINISH_PROGRESS"; saveMode: CaptureSaveMode }
  | { type: "ROOTLINE_UPDATE_FINISH_PROGRESS"; progress: RemoteSaveProgress }
  | { type: "ROOTLINE_ABORT_FINISH" }
  | { type: "ROOTLINE_COMMIT_FINISH" }
  | { type: "ROOTLINE_SHOW_COMPLETE"; session: RootlineSession }
  | { type: "ROOTLINE_RECORDING_STATE"; recordingState?: RecordingSessionState; recording?: RecordingEvidence }
  | { type: "ROOTLINE_CLEANUP" }

export interface RuntimeSnapshotResponse {
  ok: boolean
  page?: PageInfo
  resources?: NetworkEvidence[]
  targets?: SelectedTarget[]
  error?: string
}

export interface RuntimePrepareFinishResponse {
  ok: boolean
  hidden: boolean
}

export interface RuntimeStartResponse {
  ok: boolean
  visible: boolean
}

export interface ExtensionResponse<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}

export interface ActiveState {
  tab: {
    id?: number
    title?: string
    url?: string
  } | null
  supported: boolean
  unsupportedReason?: string
  session: SessionSummary | null
  recording: import("./recording-messages").ActiveRecordingRuntime | null
  saveConfig?: CaptureSaveConfig
}

export type SessionResponse = ExtensionResponse<RootlineSession>
