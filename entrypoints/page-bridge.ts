import { collectTarget, updateTargetRect } from "../src/lib/capture/dom"
import type { ExtensionRequest, ExtensionResponse, RuntimePrepareFinishResponse, RuntimeSnapshotResponse, RuntimeStartResponse, TabRuntimeRequest } from "../src/lib/messaging"
import { redactUrl } from "../src/lib/redaction"
import type {
  ConsoleEvidence,
  CaptureSaveMode,
  NetworkEvidence,
  PageInfo,
  ReactRuntimeHint,
  RecordingEvidence,
  RecordingSessionState,
  RootlineSession,
  SelectedTarget,
} from "../src/lib/types"
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

declare global {
  var __ROOTLINE_BRIDGE_INSTALLED__: boolean | undefined
}

const RUNTIME_SOURCE = "rootline-runtime"
const BRIDGE_SOURCE = "rootline-bridge"
const MAX_TARGETS = 10
const ISSUE_TEXT_MAX_LENGTH = 300
const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [contenteditable="true"]'
const PANEL_PLACEMENT_STORAGE_KEY = "rootlineRuntimePanelPlacement"
const PANEL_EDGE_SNAP_DISTANCE = 36
const PANEL_EDGE_HANDLE_WIDTH = 15
const PANEL_VIEWPORT_MARGIN = 12
const PANEL_IDLE_COLLAPSE_DELAY_MS = 1_000
const PANEL_LEAVE_IDLE_DELAY_MS = 500
const EDITOR_HIDE_DELAY_MS = 2_000
const HOVER_UPDATE_MIN_MS = 80

type SelectionMode = "element" | "spacing"
type SelectionKind = "element" | "spacing" | "text-line"
type PanelEdge = "left" | "right" | null

interface SpacingRuntimeTarget {
  axis: "horizontal" | "vertical"
  distance: number
  fromElement: Element
  toElement: Element
}

interface RuntimeTarget {
  element: Element
  kind: SelectionKind
  rect: DOMRect
  spacing?: SpacingRuntimeTarget
  text?: string
}

interface PanelPlacement {
  edge: PanelEdge
  leftRatio?: number
  topRatio: number
}

interface PanelDragState {
  pointerId: number
  startLeft: number
  startTop: number
  startPointerX: number
  startPointerY: number
}

interface EditorState {
  element: Element | null
  target: SelectedTarget
  isNew: boolean
}

interface BridgeState {
  sessionId: string | null
  startedAt: string | null
  selectionEnabled: boolean
  selectionMode: SelectionMode
  host: HTMLDivElement | null
  shadow: ShadowRoot | null
  highlight: HTMLDivElement | null
  selectedElements: Map<string, Element>
  selectedTargets: Map<string, SelectedTarget>
  hoveredTarget: RuntimeTarget | null
  pendingTarget: RuntimeTarget | null
  editor: EditorState | null
  editorPinned: boolean
  editorReopenTargetId: string | null
  editorHideTimer: number | null
  panelDockEdge: PanelEdge
  panelDrag: PanelDragState | null
  panelIdleTimer: number | null
  panelPlacement: PanelPlacement | null
  lastHoverUpdateAt: number
  completedSession: RootlineSession | null
  abortController: AbortController | null
  originalCursor: string | null
  heartbeatTimer: number | null
  finishPrepared: boolean
  feedbackTimer: number | null
  recordingState: RecordingSessionState | null
  recording: RecordingEvidence | null
  recordingTimer: number | null
}

const state: BridgeState = {
  sessionId: null,
  startedAt: null,
  selectionEnabled: false,
  selectionMode: "element",
  host: null,
  shadow: null,
  highlight: null,
  selectedElements: new Map(),
  selectedTargets: new Map(),
  hoveredTarget: null,
  pendingTarget: null,
  editor: null,
  editorPinned: false,
  editorReopenTargetId: null,
  editorHideTimer: null,
  panelDockEdge: null,
  panelDrag: null,
  panelIdleTimer: null,
  panelPlacement: null,
  lastHoverUpdateAt: 0,
  completedSession: null,
  abortController: null,
  originalCursor: null,
  heartbeatTimer: null,
  finishPrepared: false,
  feedbackTimer: null,
  recordingState: null,
  recording: null,
  recordingTimer: null,
}

function pageInfo(): PageInfo {
  return {
    url: redactUrl(location.href),
    title: document.title,
    origin: location.origin,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    userAgent: navigator.userAgent,
    language: document.documentElement.lang || navigator.language,
    capturedAt: new Date().toISOString(),
  }
}

function send(message: ExtensionRequest): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    // Extension reloads can invalidate the bridge; the page overlay remains local.
  })
}

async function request<T>(message: ExtensionRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T>
  if (!response?.ok) throw new Error(response?.error ?? "Rootline 操作失败。")
  return response.data as T
}

function isConsoleEvidence(value: unknown): value is ConsoleEvidence {
  if (!value || typeof value !== "object") return false
  const event = value as Record<string, unknown>
  return typeof event.id === "string"
    && typeof event.timestamp === "string"
    && typeof event.message === "string"
    && ["log", "info", "warn", "error", "debug"].includes(String(event.level))
}

function isNetworkEvidence(value: unknown): value is NetworkEvidence {
  if (!value || typeof value !== "object") return false
  const event = value as Record<string, unknown>
  return typeof event.id === "string"
    && typeof event.timestamp === "string"
    && typeof event.method === "string"
    && typeof event.url === "string"
    && ["fetch", "xhr", "resource"].includes(String(event.type))
}

function resourceEvidence(): NetworkEvidence[] {
  const startedAt = state.startedAt ? Date.parse(state.startedAt) : 0
  return performance
    .getEntriesByType("resource")
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
    .filter((entry) => performance.timeOrigin + entry.startTime >= startedAt)
    .filter((entry) => !["fetch", "xmlhttprequest"].includes(entry.initiatorType))
    .slice(-100)
    .map((entry) => ({
      id: crypto.randomUUID(),
      timestamp: new Date(performance.timeOrigin + entry.startTime).toISOString(),
      method: "GET",
      url: redactUrl(entry.name),
      type: "resource",
      resourceType: entry.initiatorType || "other",
      duration: entry.duration,
    }))
}

function isOverlayNode(target: EventTarget | null): boolean {
  return target instanceof Node && Boolean(state.host?.contains(target))
}

function updateHighlight(element: Element | null): void {
  const highlight = state.highlight
  if (!highlight) return
  if (!element) {
    highlight.style.display = "none"
    return
  }
  const rect = element.getBoundingClientRect()
  highlight.style.display = "block"
  highlight.style.left = `${rect.left}px`
  highlight.style.top = `${rect.top}px`
  highlight.style.width = `${rect.width}px`
  highlight.style.height = `${rect.height}px`
}

function runtimeElementLabel(element: Element): string {
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`
}

function targetLabel(target: RuntimeTarget): string {
  if (target.kind === "text-line") {
    const text = target.text?.trim() || "未命名文字"
    return `文字行 · ${text.length > 28 ? `${text.slice(0, 28)}...` : text}`
  }
  if (target.kind === "spacing" && target.spacing) {
    return `间距 · ${target.spacing.axis === "vertical" ? "垂直" : "水平"} ${Math.round(target.spacing.distance)}px`
  }
  return runtimeElementLabel(target.element)
}

function meaningfulParent(target: RuntimeTarget): RuntimeTarget | null {
  if (target.kind !== "element") return null
  let parent = target.element.parentElement
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const rect = parent.getBoundingClientRect()
    const style = getComputedStyle(parent)
    const larger = rect.width > target.rect.width + 2 || rect.height > target.rect.height + 2
    if (larger && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") {
      return { element: parent, kind: "element", rect }
    }
    parent = parent.parentElement
  }
  return null
}

function positionTargetToolbar(target: RuntimeTarget): void {
  const toolbar = state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")
  const parentButton = state.shadow?.querySelector<HTMLButtonElement>("[data-select-parent]")
  if (!toolbar) return
  const rect = target.rect
  const gap = 8
  toolbar.hidden = false
  const width = toolbar.offsetWidth || 196
  const height = toolbar.offsetHeight || 46
  const maxLeft = Math.max(gap, window.innerWidth - width - gap)
  const maxTop = Math.max(gap, window.innerHeight - height - gap)
  const top = rect.top - height - gap >= gap ? rect.top - height - gap : rect.bottom + gap
  toolbar.style.left = `${Math.min(maxLeft, Math.max(gap, rect.left))}px`
  toolbar.style.top = `${Math.min(maxTop, Math.max(gap, top))}px`
  const parent = meaningfulParent(target)
  if (parentButton) {
    parentButton.disabled = !parent
    parentButton.title = parent ? `选中父级组件：${targetLabel(parent)}` : "没有可选父级组件"
  }
}

function inspectorLines(target: RuntimeTarget): string[] {
  if (target.kind === "spacing" && target.spacing) {
    return [
      targetLabel(target),
      `${runtimeElementLabel(target.spacing.fromElement)} -> ${runtimeElementLabel(target.spacing.toElement)}`,
      `${Math.round(target.rect.width)} x ${Math.round(target.rect.height)}px`,
    ]
  }
  const style = getComputedStyle(target.element)
  return [
    targetLabel(target),
    `${Math.round(target.rect.width)} x ${Math.round(target.rect.height)}px`,
    `font ${style.fontFamily} / ${style.fontSize} / line ${style.lineHeight}`,
    `weight ${style.fontWeight} / style ${style.fontStyle}`,
    `display ${style.display}${style.position ? ` / ${style.position}` : ""}`,
    `p ${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    `m ${style.marginTop} ${style.marginRight} ${style.marginBottom} ${style.marginLeft}`,
  ]
}

function positionHoverLabel(target: RuntimeTarget): void {
  const label = state.shadow?.querySelector<HTMLElement>("[data-hover-label]")
  if (!label) return
  const gap = 8
  const margin = 12
  const width = label.offsetWidth || 260
  const height = label.offsetHeight || 36
  const maxLeft = Math.max(margin, window.innerWidth - width - margin)
  const maxTop = Math.max(margin, window.innerHeight - height - margin)
  const top = target.rect.top - height - gap
  label.style.left = `${Math.min(maxLeft, Math.max(margin, target.rect.left))}px`
  label.style.top = `${top >= margin ? top : Math.min(maxTop, Math.max(margin, target.rect.bottom + gap))}px`
}

function renderHoverTarget(): void {
  const highlight = state.highlight
  const label = state.shadow?.querySelector<HTMLElement>("[data-hover-label]")
  const target = state.pendingTarget ?? state.hoveredTarget
  if (!highlight || !label || !state.selectionEnabled || !target) {
    updateHighlight(null)
    if (label) label.hidden = true
    state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")?.setAttribute("hidden", "")
    return
  }
  updateHighlight(target.element)
  highlight.style.left = `${target.rect.left}px`
  highlight.style.top = `${target.rect.top}px`
  highlight.style.width = `${Math.max(1, target.rect.width)}px`
  highlight.style.height = `${Math.max(1, target.rect.height)}px`
  highlight.dataset.kind = target.kind
  highlight.toggleAttribute("data-pending", Boolean(state.pendingTarget))
  if (state.pendingTarget) {
    label.hidden = true
    positionTargetToolbar(target)
    return
  }
  state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")?.setAttribute("hidden", "")
  label.hidden = false
  const now = performance.now()
  if (now - state.lastHoverUpdateAt >= HOVER_UPDATE_MIN_MS || !label.textContent) {
    state.lastHoverUpdateAt = now
    label.textContent = inspectorLines(target).join("\n")
  }
  positionHoverLabel(target)
}

function syncPendingTarget(): void {
  const toolbar = state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")
  const target = state.pendingTarget
  if (!target?.element.isConnected || !state.selectionEnabled) {
    if (toolbar) toolbar.hidden = true
    if (target && !target.element.isConnected) state.pendingTarget = null
    return
  }
  target.rect = target.element.getBoundingClientRect()
  renderHoverTarget()
}

function clearPendingTarget(): void {
  state.pendingTarget = null
  state.hoveredTarget = null
  const toolbar = state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")
  if (toolbar) toolbar.hidden = true
  renderHoverTarget()
}

function setPendingTarget(target: RuntimeTarget): void {
  state.pendingTarget = target
  state.hoveredTarget = target
  renderHoverTarget()
  setFeedback(`已锁定 ${targetLabel(target)}。`)
  state.shadow?.querySelector<HTMLButtonElement>("[data-confirm-target]")?.focus()
}

function promotePendingTargetToParent(): void {
  const target = state.pendingTarget
  if (!target) return
  const parent = meaningfulParent(target)
  if (!parent) return
  setPendingTarget(parent)
}

function reselectPendingTarget(): void {
  clearPendingTarget()
  setFeedback("已取消当前目标。")
}

function selectedElementFromEvent(event: Event): Element | null {
  const path = event.composedPath()
  return path.find((item): item is Element => item instanceof Element && item !== state.host) ?? null
}

function selectableElement(element: Element): Element {
  return element.closest(CONTROL_SELECTOR) ?? element
}

function elementTarget(element: Element): RuntimeTarget {
  const target = selectableElement(element)
  return { element: target, kind: "element", rect: target.getBoundingClientRect() }
}

function textLineTarget(x: number, y: number): RuntimeTarget | null {
  const range = document.caretRangeFromPoint?.(x, y)
  const node = range?.startContainer
  if (!(node instanceof Text) || !node.textContent?.trim() || !node.parentElement) return null
  const lineRange = document.createRange()
  lineRange.selectNodeContents(node)
  const rect = Array.from(lineRange.getClientRects()).find((candidate) => (
    x >= candidate.left && x <= candidate.right && y >= candidate.top && y <= candidate.bottom
  ))
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return { element: node.parentElement, kind: "text-line", rect, text: node.textContent.trim() }
}

function visibleSpacingCandidates(x: number, y: number): Element[] {
  const output = new Set<Element>()
  const add = (element: Element | null): void => {
    if (!element || element === state.host || state.host?.contains(element) || output.size >= 120) return
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const style = getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") return
    output.add(element)
  }

  let current = document.elementFromPoint(x, y)
  for (let depth = 0; current && depth < 6; depth += 1) {
    add(current)
    add(current.previousElementSibling)
    add(current.nextElementSibling)
    const children = Array.from(current.parentElement?.children ?? []).slice(0, 80)
    children.forEach(add)
    current = current.parentElement
  }
  return Array.from(output)
}

function spacingTarget(x: number, y: number): RuntimeTarget | null {
  const elements = visibleSpacingCandidates(x, y)
  let best: { score: number; target: RuntimeTarget } | null = null
  for (let index = 0; index < elements.length; index += 1) {
    const from = elements[index]
    if (!from) continue
    const fromRect = from.getBoundingClientRect()
    for (let nested = index + 1; nested < elements.length; nested += 1) {
      const to = elements[nested]
      if (!to || from.parentElement !== to.parentElement) continue
      if (from.contains(to) || to.contains(from)) continue
      const toRect = to.getBoundingClientRect()
      const horizontalOverlap = Math.min(fromRect.right, toRect.right) - Math.max(fromRect.left, toRect.left)
      const verticalOverlap = Math.min(fromRect.bottom, toRect.bottom) - Math.max(fromRect.top, toRect.top)
      let rect: DOMRect | null = null
      let axis: "horizontal" | "vertical" = "vertical"
      let distance = 0
      if (horizontalOverlap > 4 && (fromRect.bottom <= toRect.top || toRect.bottom <= fromRect.top)) {
        const top = Math.min(fromRect.bottom, toRect.bottom)
        const bottom = Math.max(fromRect.top, toRect.top)
        const left = Math.max(fromRect.left, toRect.left)
        distance = bottom - top
        rect = new DOMRect(left, top, horizontalOverlap, distance)
      } else if (verticalOverlap > 4 && (fromRect.right <= toRect.left || toRect.right <= fromRect.left)) {
        axis = "horizontal"
        const left = Math.min(fromRect.right, toRect.right)
        const right = Math.max(fromRect.left, toRect.left)
        const top = Math.max(fromRect.top, toRect.top)
        distance = right - left
        rect = new DOMRect(left, top, distance, verticalOverlap)
      }
      if (!rect || distance <= 0 || distance > 240) continue
      if (x < rect.left - 8 || x > rect.right + 8 || y < rect.top - 8 || y > rect.bottom + 8) continue
      const score = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2)) + distance * 0.02
      if (!best || score < best.score) {
        best = {
          score,
          target: {
            element: from,
            kind: "spacing",
            rect,
            spacing: { axis, distance, fromElement: from, toElement: to },
          },
        }
      }
    }
  }
  return best?.target ?? null
}

function runtimeTargetFromEvent(event: Event): RuntimeTarget | null {
  if (!("clientX" in event && "clientY" in event)) return null
  const x = Number(event.clientX)
  const y = Number(event.clientY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (state.selectionMode === "spacing") return textLineTarget(x, y) ?? spacingTarget(x, y)
  const element = selectedElementFromEvent(event)
  return element ? elementTarget(element) : null
}

function inspectReact(element: Element, targetId: string): Promise<ReactRuntimeHint> {
  const requestId = crypto.randomUUID()
  element.setAttribute("data-rootline-target-id", targetId)
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener)
      element.removeAttribute("data-rootline-target-id")
      resolve({
        available: false,
        componentChain: [],
        propsKeys: [],
        boundary: "React 运行信息读取超时。",
      })
    }, 500)
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.source !== RUNTIME_SOURCE ||
        event.data?.type !== "react-hint" ||
        event.data?.requestId !== requestId
      ) return
      window.clearTimeout(timeout)
      window.removeEventListener("message", listener)
      element.removeAttribute("data-rootline-target-id")
      resolve(event.data.hint as ReactRuntimeHint)
    }
    window.addEventListener("message", listener)
    window.postMessage({ source: BRIDGE_SOURCE, type: "inspect-react", sessionId: state.sessionId, requestId, targetId }, "*")
  })
}

function setFeedback(message: string, tone: "error" | "success" | "neutral" = "neutral"): void {
  if (state.feedbackTimer !== null) window.clearTimeout(state.feedbackTimer)
  state.feedbackTimer = null
  const complete = state.shadow?.querySelector<HTMLElement>("[data-complete]")
  const feedback = state.shadow?.querySelector<HTMLElement>(
    complete && !complete.hidden ? "[data-complete-feedback]" : "[data-workflow-feedback]",
  )
  if (!feedback) return
  feedback.textContent = message
  feedback.dataset.tone = tone
  feedback.hidden = !message
  if (message && tone === "success") {
    state.feedbackTimer = window.setTimeout(() => {
      feedback.textContent = ""
      feedback.hidden = true
      state.feedbackTimer = null
    }, 3_000)
  }
}

function panelElement(): HTMLElement | null {
  return state.shadow?.querySelector<HTMLElement>("[data-panel]") ?? null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function clearPanelIdleTimer(): void {
  if (state.panelIdleTimer !== null) window.clearTimeout(state.panelIdleTimer)
  state.panelIdleTimer = null
}

function positionPanelAtEdge(edge: Exclude<PanelEdge, null>, collapsed: boolean): void {
  const panel = panelElement()
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const width = rect.width || panel.offsetWidth || 346
  const height = rect.height || panel.offsetHeight || 360
  const currentTop = Number.parseFloat(panel.style.top) || (window.innerHeight - height) / 2
  const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN)
  const top = clamp(currentTop, PANEL_VIEWPORT_MARGIN, maxTop)
  const left = edge === "left"
    ? collapsed ? -(width - PANEL_EDGE_HANDLE_WIDTH) : PANEL_VIEWPORT_MARGIN
    : collapsed ? window.innerWidth - PANEL_EDGE_HANDLE_WIDTH : window.innerWidth - width - PANEL_VIEWPORT_MARGIN
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto", transform: "none" })
}

function setPanelCollapsed(collapsed: boolean): void {
  if (!state.panelDockEdge || !panelElement()) {
    state.host?.removeAttribute("data-panel-collapsed")
    return
  }
  state.host?.toggleAttribute("data-panel-collapsed", collapsed)
  positionPanelAtEdge(state.panelDockEdge, collapsed)
}

function schedulePanelIdle(delayMs: number): void {
  clearPanelIdleTimer()
  if (!state.panelDockEdge) return
  state.panelIdleTimer = window.setTimeout(() => {
    state.panelIdleTimer = null
    if (state.panelDockEdge) setPanelCollapsed(true)
  }, delayMs)
}

function activatePanel(): void {
  clearPanelIdleTimer()
  if (state.panelDockEdge) setPanelCollapsed(false)
}

function movePanelTo(left: number, top: number): void {
  const panel = panelElement()
  if (!panel) return
  const rect = panel.getBoundingClientRect()
  const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - rect.width - PANEL_VIEWPORT_MARGIN)
  const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - rect.height - PANEL_VIEWPORT_MARGIN)
  Object.assign(panel.style, {
    left: `${clamp(left, PANEL_VIEWPORT_MARGIN, maxLeft)}px`,
    top: `${clamp(top, PANEL_VIEWPORT_MARGIN, maxTop)}px`,
    right: "auto",
    bottom: "auto",
    transform: "none",
  })
}

function clampPanelToViewport(): void {
  const panel = panelElement()
  if (!panel) return
  if (state.panelDockEdge) {
    positionPanelAtEdge(state.panelDockEdge, state.host?.hasAttribute("data-panel-collapsed") ?? false)
    return
  }
  const rect = panel.getBoundingClientRect()
  movePanelTo(rect.left, rect.top)
}

function restorePanelPlacement(): void {
  const panel = panelElement()
  const placement = state.panelPlacement
  if (!panel || !placement) {
    clampPanelToViewport()
    return
  }
  if (placement.edge) {
    state.panelDockEdge = placement.edge
    positionPanelAtEdge(placement.edge, state.host?.hasAttribute("data-panel-collapsed") ?? false)
    return
  }
  const width = panel.offsetWidth || 288
  const height = panel.offsetHeight || 360
  movePanelTo(
    (placement.leftRatio ?? 1) * Math.max(1, window.innerWidth - width - PANEL_VIEWPORT_MARGIN),
    placement.topRatio * Math.max(1, window.innerHeight - height),
  )
}

function currentPanelPlacement(): PanelPlacement | null {
  const panel = panelElement()
  if (!panel) return null
  const rect = panel.getBoundingClientRect()
  return {
    edge: state.panelDockEdge,
    leftRatio: clamp(rect.left / Math.max(1, window.innerWidth - rect.width), 0, 1),
    topRatio: clamp(rect.top / Math.max(1, window.innerHeight - rect.height), 0, 1),
  }
}

async function savePanelPlacement(): Promise<void> {
  const placement = currentPanelPlacement()
  if (!placement) return
  state.panelPlacement = placement
  await chrome.storage.local.set({ [PANEL_PLACEMENT_STORAGE_KEY]: placement })
}

async function initializePanelPosition(): Promise<void> {
  const panel = panelElement()
  if (!panel) return
  const stored: Record<string, unknown> = await chrome.storage.local.get(PANEL_PLACEMENT_STORAGE_KEY).catch(() => ({}))
  const candidate = stored[PANEL_PLACEMENT_STORAGE_KEY] as Partial<PanelPlacement> | undefined
  const placement = candidate
    && (candidate.edge === null || candidate.edge === "left" || candidate.edge === "right")
    && typeof candidate.topRatio === "number"
    ? candidate as PanelPlacement
    : null
  state.panelPlacement = placement ?? { edge: null, leftRatio: 1, topRatio: 0.46 }
  const width = panel.offsetWidth || 288
  const height = panel.offsetHeight || 360
  if (placement?.edge) {
    state.panelDockEdge = placement.edge
    state.host?.setAttribute("data-panel-edge", placement.edge)
    panel.style.top = `${clamp(placement.topRatio, 0, 1) * Math.max(1, window.innerHeight - height)}px`
    setPanelCollapsed(true)
  } else {
    state.panelDockEdge = null
    state.host?.removeAttribute("data-panel-edge")
    const leftRatio = typeof state.panelPlacement.leftRatio === "number" ? clamp(state.panelPlacement.leftRatio, 0, 1) : 1
    const topRatio = clamp(state.panelPlacement.topRatio, 0, 1)
    movePanelTo(
      leftRatio * Math.max(1, window.innerWidth - width - PANEL_VIEWPORT_MARGIN),
      topRatio * Math.max(1, window.innerHeight - height),
    )
    schedulePanelIdle(PANEL_IDLE_COLLAPSE_DELAY_MS)
  }
}

function startPanelDrag(event: PointerEvent): void {
  const panel = panelElement()
  if (!panel || event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const rect = panel.getBoundingClientRect()
  state.panelDrag = {
    pointerId: event.pointerId,
    startLeft: rect.left,
    startTop: rect.top,
    startPointerX: event.clientX,
    startPointerY: event.clientY,
  }
  panel.setPointerCapture(event.pointerId)
  state.panelDockEdge = null
  state.host?.removeAttribute("data-panel-edge")
  state.host?.removeAttribute("data-panel-collapsed")
  state.host?.setAttribute("data-panel-dragging", "")
  activatePanel()
  window.addEventListener("pointermove", updatePanelDrag, true)
  window.addEventListener("pointerup", finishPanelDrag, true)
  window.addEventListener("pointercancel", finishPanelDrag, true)
}

function updatePanelDrag(event: PointerEvent): void {
  const drag = state.panelDrag
  if (!drag || drag.pointerId !== event.pointerId) return
  event.preventDefault()
  movePanelTo(
    drag.startLeft + event.clientX - drag.startPointerX,
    drag.startTop + event.clientY - drag.startPointerY,
  )
}

function removePanelDragListeners(): void {
  window.removeEventListener("pointermove", updatePanelDrag, true)
  window.removeEventListener("pointerup", finishPanelDrag, true)
  window.removeEventListener("pointercancel", finishPanelDrag, true)
}

function finishPanelDrag(event: PointerEvent): void {
  const panel = panelElement()
  const drag = state.panelDrag
  if (!panel || !drag || drag.pointerId !== event.pointerId) return
  removePanelDragListeners()
  if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId)
  state.panelDrag = null
  state.host?.removeAttribute("data-panel-dragging")
  const rect = panel.getBoundingClientRect()
  if (rect.left <= PANEL_EDGE_SNAP_DISTANCE) state.panelDockEdge = "left"
  else if (window.innerWidth - rect.right <= PANEL_EDGE_SNAP_DISTANCE) state.panelDockEdge = "right"
  else state.panelDockEdge = null
  if (state.panelDockEdge) {
    state.host?.setAttribute("data-panel-edge", state.panelDockEdge)
    setPanelCollapsed(true)
  } else {
    state.host?.removeAttribute("data-panel-edge")
    clampPanelToViewport()
    schedulePanelIdle(PANEL_IDLE_COLLAPSE_DELAY_MS)
  }
  void savePanelPlacement()
}

function syncToolbar(): void {
  if (!state.shadow) return
  const count = state.shadow.querySelector<HTMLElement>("[data-count]")
  const selectButton = state.shadow.querySelector<HTMLButtonElement>("[data-select]")
  const undoButton = state.shadow.querySelector<HTMLButtonElement>("[data-undo]")
  const clearButton = state.shadow.querySelector<HTMLButtonElement>("[data-clear]")
  const finishButton = state.shadow.querySelector<HTMLButtonElement>("[data-finish]")
  const selectedCount = state.selectedTargets.size
  if (count) count.textContent = String(selectedCount)
  if (selectButton) {
    const label = selectButton.querySelector<HTMLElement>("[data-select-label]")
    const detail = selectButton.querySelector<HTMLElement>("[data-select-detail]")
    if (label) label.textContent = state.selectionEnabled ? "正在点选" : "开始标注"
    if (detail) detail.textContent = state.selectionEnabled ? "点击页面上的问题位置" : "选择页面上的问题位置"
    selectButton.dataset.active = String(state.selectionEnabled)
    selectButton.setAttribute("aria-pressed", String(state.selectionEnabled))
    selectButton.setAttribute("aria-label", state.selectionEnabled ? "结束标注" : "开始标注")
    selectButton.disabled = selectedCount >= MAX_TARGETS
  }
  state.shadow.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === state.selectionMode
    button.toggleAttribute("data-active", active)
    button.setAttribute("aria-pressed", String(active))
  })
  const hint = state.shadow.querySelector<HTMLElement>("[data-panel-hint]")
  if (hint) {
    hint.textContent = state.selectionEnabled
      ? state.selectionMode === "spacing"
        ? "标间距模式：点击组件之间的空白或文字行；点击标注框填写预期和实际结果。"
        : "控件模式：点击页面控件或元素；点击标注框填写预期和实际结果。"
      : "点击“开始标注”后，在当前标签页选择需要说明的位置。"
  }
  const shortcutAction = state.shadow.querySelector<HTMLElement>("[data-shortcut-action]")
  if (shortcutAction) shortcutAction.textContent = state.selectionEnabled ? "退出标注" : "开始标注"
  if (undoButton) undoButton.disabled = selectedCount === 0
  if (clearButton) clearButton.disabled = selectedCount === 0
  if (finishButton) {
    finishButton.disabled = false
    finishButton.textContent = state.recordingState?.status === "recording"
      ? "停止录屏并生成证据"
      : "结束并生成证据"
  }
  syncRecordingStatus()
}

function formatRecordingTime(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function clearRecordingTimer(): void {
  if (state.recordingTimer !== null) window.clearInterval(state.recordingTimer)
  state.recordingTimer = null
}

function syncRecordingStatus(): void {
  const badge = state.shadow?.querySelector<HTMLElement>("[data-capture-mode]")
  const strip = state.shadow?.querySelector<HTMLElement>("[data-recording-strip]")
  const label = state.shadow?.querySelector<HTMLElement>("[data-recording-label]")
  const time = state.shadow?.querySelector<HTMLElement>("[data-recording-time]")
  const stop = state.shadow?.querySelector<HTMLButtonElement>("[data-stop-recording]")
  const recordingState = state.recordingState
  const isVideo = Boolean(recordingState || state.recording)
  if (badge) {
    badge.textContent = isVideo ? "录屏" : "截图"
    badge.toggleAttribute("data-recording", isVideo)
  }
  if (!strip) return
  strip.hidden = !isVideo
  if (!isVideo) {
    clearRecordingTimer()
    return
  }
  const status = recordingState?.status ?? (state.recording ? "stopped" : "starting")
  strip.dataset.status = status
  if (label) {
    label.textContent = status === "recording"
      ? "正在录制整个屏幕"
      : status === "failed"
        ? "录屏未能完成"
        : status === "starting"
          ? "正在请求屏幕权限"
          : "录屏已停止，可继续标注"
  }
  if (time) {
    const startedAt = recordingState?.startedAt ?? state.recording?.startedAt
    const durationMs = status === "recording" && startedAt
      ? Date.now() - Date.parse(startedAt)
      : state.recording?.durationMs ?? (startedAt && recordingState?.stoppedAt
          ? Date.parse(recordingState.stoppedAt) - Date.parse(startedAt)
          : 0)
    time.textContent = formatRecordingTime(durationMs)
  }
  if (stop) stop.hidden = status !== "recording"
  clearRecordingTimer()
  if (status === "recording") {
    state.recordingTimer = window.setInterval(() => syncRecordingStatus(), 1_000)
  }
  if (status === "failed" && recordingState?.error) setFeedback(recordingState.error, "error")
}

async function stopRecordingFromPage(): Promise<void> {
  if (!state.sessionId || state.recordingState?.status !== "recording") return
  const button = state.shadow?.querySelector<HTMLButtonElement>("[data-stop-recording]")
  if (button) {
    button.disabled = true
    button.dataset.state = "loading"
    button.textContent = "正在停止"
  }
  try {
    const session = await request<RootlineSession>({ type: "STOP_RECORDING", sessionId: state.sessionId })
    state.recordingState = session.recordingState ?? null
    state.recording = session.recording ?? null
    syncToolbar()
    setFeedback("录屏已停止，可以继续标注或生成证据。", "success")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "停止录屏失败。", "error")
  } finally {
    if (button) {
      button.disabled = false
      button.dataset.state = "default"
      button.textContent = "停止"
    }
  }
}

function setSelection(enabled: boolean): void {
  state.selectionEnabled = enabled && state.selectedTargets.size < MAX_TARGETS
  document.documentElement.style.cursor = state.selectionEnabled ? "crosshair" : (state.originalCursor ?? "")
  if (!state.selectionEnabled) clearPendingTarget()
  state.host?.toggleAttribute("data-selecting", state.selectionEnabled)
  activatePanel()
  syncToolbar()
}

function setSelectionMode(mode: SelectionMode): void {
  state.selectionMode = mode
  clearPendingTarget()
  syncToolbar()
}

function targetRect(target: SelectedTarget): SelectedTarget {
  const element = state.selectedElements.get(target.id)
  return element && (target.selectionKind ?? "element") === "element" ? updateTargetRect(target, element) : target
}

function syncMarkers(): void {
  const layer = state.shadow?.querySelector<HTMLElement>("[data-target-layer]")
  if (!layer) return
  layer.replaceChildren()
  Array.from(state.selectedTargets.values()).forEach((storedTarget, index) => {
    const target = targetRect(storedTarget)
    state.selectedTargets.set(target.id, target)
    if (state.editor?.target.id === target.id) state.editor.target = target
    const box = document.createElement("div")
    box.className = "target-box"
    box.style.left = `${target.rect.x}px`
    box.style.top = `${target.rect.y}px`
    box.style.width = `${target.rect.width}px`
    box.style.height = `${target.rect.height}px`
    box.dataset.active = String(state.editor?.target.id === target.id)
    const edit = document.createElement("button")
    edit.className = "target-index"
    edit.type = "button"
    edit.textContent = String(index + 1)
    edit.title = `编辑标注 ${index + 1}`
    edit.setAttribute("aria-label", `编辑标注 ${index + 1}`)
    const openEditor = () => showEditor(target, state.selectedElements.get(target.id) ?? null, false)
    edit.addEventListener("click", openEditor)
    box.addEventListener("click", openEditor)
    box.addEventListener("pointerenter", () => {
      if (state.editor?.target.id === target.id) {
        clearEditorHideTimer()
        positionEditor(target)
      } else if (state.editorReopenTargetId === target.id) {
        openEditor()
      }
    })
    box.addEventListener("pointerleave", () => {
      if (state.editor?.target.id === target.id) scheduleEditorHide()
    })
    box.append(edit)
    layer.append(box)
    if (state.editor?.target.id === target.id) positionEditor(target)
  })
  syncPendingTarget()
}

function positionEditor(target: SelectedTarget): void {
  const editor = state.shadow?.querySelector<HTMLElement>("[data-editor]")
  if (!editor) return
  const width = Math.min(320, Math.max(232, window.innerWidth - 24))
  const rect = target.rect
  let left = rect.x + rect.width + 12
  if (left + width > window.innerWidth - 8) left = rect.x - width - 12
  if (left < 8) left = Math.min(Math.max(8, rect.x), Math.max(8, window.innerWidth - width - 8))
  editor.style.width = `${width}px`
  editor.style.left = `${left}px`
  editor.style.top = `${Math.max(12, Math.min(rect.y, window.innerHeight - 320))}px`
  window.requestAnimationFrame(() => {
    const height = editor.getBoundingClientRect().height
    editor.style.top = `${Math.max(12, Math.min(rect.y, window.innerHeight - height - 12))}px`
  })
}

function validateEditor(): boolean {
  const actual = state.shadow?.querySelector<HTMLTextAreaElement>("[data-actual]")
  const expected = state.shadow?.querySelector<HTMLTextAreaElement>("[data-expected]")
  const save = state.shadow?.querySelector<HTMLButtonElement>("[data-save-annotation]")
  if (save) save.disabled = false
  if (actual) actual.removeAttribute("aria-invalid")
  if (expected) expected.removeAttribute("aria-invalid")
  return true
}

function updateCounters(): void {
  const actual = state.shadow?.querySelector<HTMLTextAreaElement>("[data-actual]")
  const expected = state.shadow?.querySelector<HTMLTextAreaElement>("[data-expected]")
  const actualCount = state.shadow?.querySelector<HTMLElement>("[data-actual-count]")
  const expectedCount = state.shadow?.querySelector<HTMLElement>("[data-expected-count]")
  if (actualCount) actualCount.textContent = `${actual?.value.length ?? 0}/${ISSUE_TEXT_MAX_LENGTH}`
  if (expectedCount) expectedCount.textContent = `${expected?.value.length ?? 0}/${ISSUE_TEXT_MAX_LENGTH}`
  validateEditor()
}

function showEditor(target: SelectedTarget, element: Element | null, isNew: boolean): void {
  const editor = state.shadow?.querySelector<HTMLElement>("[data-editor]")
  const actual = state.shadow?.querySelector<HTMLTextAreaElement>("[data-actual]")
  const expected = state.shadow?.querySelector<HTMLTextAreaElement>("[data-expected]")
  const remove = state.shadow?.querySelector<HTMLButtonElement>("[data-remove-annotation]")
  if (!editor || !actual || !expected) return
  state.editor = { element, target, isNew }
  state.editorReopenTargetId = target.id
  state.editorPinned = false
  clearEditorHideTimer()
  actual.value = target.annotation?.actualResult ?? ""
  expected.value = target.annotation?.expectedResult ?? ""
  delete actual.dataset.touched
  delete expected.dataset.touched
  if (remove) {
    remove.hidden = false
    remove.textContent = isNew ? "取消标注" : "删除标注"
  }
  editor.hidden = false
  positionEditor(target)
  updateCounters()
  syncToolbar()
  syncMarkers()
}

function clearEditorHideTimer(): void {
  if (state.editorHideTimer !== null) window.clearTimeout(state.editorHideTimer)
  state.editorHideTimer = null
}

function scheduleEditorHide(): void {
  if (state.editorPinned) return
  clearEditorHideTimer()
  state.editorHideTimer = window.setTimeout(() => {
    state.editorHideTimer = null
    if (!state.editorPinned) closeEditor(false, true)
  }, EDITOR_HIDE_DELAY_MS)
}

function closeEditor(resumeSelection = false, keepReopen = false): void {
  clearEditorHideTimer()
  const editor = state.shadow?.querySelector<HTMLElement>("[data-editor]")
  if (editor) editor.hidden = true
  state.editor = null
  state.editorPinned = false
  if (!keepReopen) state.editorReopenTargetId = null
  syncToolbar()
  syncMarkers()
  if (resumeSelection) setSelection(true)
}

async function saveEditor(): Promise<void> {
  if (!state.editor || !state.sessionId) return
  const actual = state.shadow?.querySelector<HTMLTextAreaElement>("[data-actual]")
  const expected = state.shadow?.querySelector<HTMLTextAreaElement>("[data-expected]")
  if (!actual || !expected) return
  const target: SelectedTarget = {
    ...state.editor.target,
    annotation: {
      actualResult: actual.value.trim(),
      expectedResult: expected.value.trim(),
    },
  }
  const save = state.shadow?.querySelector<HTMLButtonElement>("[data-save-annotation]")
  if (save) {
    save.disabled = true
    save.dataset.state = "loading"
    save.textContent = "正在保存"
  }
  try {
    await request({ type: "TARGET_SELECTED", sessionId: state.sessionId, target })
    state.selectedTargets.set(target.id, target)
    if (state.editor.element) state.selectedElements.set(target.id, state.editor.element)
    closeEditor(false)
    syncMarkers()
    setFeedback(`标注 ${state.selectedTargets.size} 已更新，可继续选择。`, "success")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "标注保存失败。", "error")
  } finally {
    if (save) {
      save.dataset.state = "default"
      save.textContent = "确定"
    }
    validateEditor()
  }
}

function removeTarget(targetId: string): void {
  if (!state.sessionId || !state.selectedTargets.has(targetId)) return
  state.selectedTargets.delete(targetId)
  state.selectedElements.delete(targetId)
  send({ type: "TARGET_REMOVED", sessionId: state.sessionId, targetId })
  syncMarkers()
  syncToolbar()
}

function removeEditedTarget(): void {
  const editor = state.editor
  if (!editor) return
  removeTarget(editor.target.id)
  closeEditor()
  setFeedback(editor.isNew ? "已取消本次标注。" : "标注已删除。")
}

function undoLastTarget(): void {
  const targetId = Array.from(state.selectedTargets.keys()).at(-1)
  if (!targetId) return
  removeTarget(targetId)
  setFeedback("已撤销上一条标注。")
}

function clearTargets(): void {
  const ids = Array.from(state.selectedTargets.keys())
  ids.forEach(removeTarget)
  setFeedback("已清空全部标注。")
}

function runtimeTargetOptions(target: RuntimeTarget): Parameters<typeof collectTarget>[3] {
  const rect = {
    x: Math.round(target.rect.x),
    y: Math.round(target.rect.y),
    width: Math.round(target.rect.width),
    height: Math.round(target.rect.height),
  }
  return {
    rect,
    selectionKind: target.kind,
    ...(target.text ? { text: target.text } : {}),
    ...(target.spacing ? {
      spacing: {
        axis: target.spacing.axis,
        distance: Math.round(target.spacing.distance),
        from: runtimeElementLabel(target.spacing.fromElement),
        to: runtimeElementLabel(target.spacing.toElement),
      },
    } : {}),
  }
}

async function selectRuntimeTarget(runtimeTarget: RuntimeTarget): Promise<void> {
  if (!state.sessionId || state.selectedTargets.size >= MAX_TARGETS || state.editor) return
  const sessionId = state.sessionId
  const targetId = crypto.randomUUID()
  const target = collectTarget(runtimeTarget.element, undefined, targetId, runtimeTargetOptions(runtimeTarget))
  state.selectedTargets.set(target.id, target)
  state.selectedElements.set(target.id, runtimeTarget.element)
  clearPendingTarget()
  syncMarkers()
  syncToolbar()
  showEditor(target, runtimeTarget.element, true)
  setFeedback(`已添加标注 ${state.selectedTargets.size}，说明可稍后补充。`, "success")
  try {
    await request({ type: "TARGET_SELECTED", sessionId, target })
    const hint = await inspectReact(runtimeTarget.element, targetId)
    const latest = state.selectedTargets.get(target.id) ?? target
    const enriched = { ...latest, react: hint }
    state.selectedTargets.set(target.id, enriched)
    const editorState = state.editor as EditorState | null
    if (editorState?.target.id === target.id) editorState.target = enriched
    await request({ type: "TARGET_SELECTED", sessionId, target: enriched })
  } catch (error) {
    removeTarget(target.id)
    const editorState = state.editor as EditorState | null
    if (editorState?.target.id === target.id) closeEditor()
    setFeedback(error instanceof Error ? error.message : "标注保存失败。", "error")
  }
}

function installSelectionListeners(controller: AbortController): void {
  const signal = controller.signal
  document.addEventListener("pointermove", (event) => {
    if (!state.selectionEnabled || isOverlayNode(event.target)) return
    if (state.pendingTarget) return
    state.hoveredTarget = runtimeTargetFromEvent(event)
    renderHoverTarget()
  }, { capture: true, signal })
  document.addEventListener("pointerdown", (event) => {
    if (!state.selectionEnabled || state.pendingTarget || isOverlayNode(event.target)) return
    if (!runtimeTargetFromEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, { capture: true, signal })
  document.addEventListener("click", (event) => {
    if (!state.selectionEnabled || isOverlayNode(event.target)) return
    const target = runtimeTargetFromEvent(event)
    if (!target) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (state.pendingTarget) return
    if (state.editor) closeEditor(false, true)
    setPendingTarget(target)
  }, { capture: true, signal })
  document.addEventListener("keydown", (event) => {
    const editing = event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
      || (event.target instanceof HTMLElement && event.target.isContentEditable)
    if (event.key.toLowerCase() === "a" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      setSelection(!state.selectionEnabled)
      return
    }
    if (event.key !== "Escape") return
    if (state.editor) {
      event.preventDefault()
      closeEditor(false, true)
    } else if (state.pendingTarget) {
      event.preventDefault()
      reselectPendingTarget()
    } else if (state.selectionEnabled) {
      event.preventDefault()
      setSelection(false)
    }
  }, { capture: true, signal })
  window.addEventListener("scroll", syncMarkers, { capture: true, passive: true, signal })
  window.addEventListener("resize", () => {
    syncMarkers()
    restorePanelPlacement()
  }, { passive: true, signal })
}

async function annotatedCapture(session: RootlineSession): Promise<string | undefined> {
  if (!session.screenshot.dataUrl) return undefined
  const image = new Image()
  image.src = session.screenshot.dataUrl
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext("2d")
  if (!context) return undefined
  context.drawImage(image, 0, 0)
  const scaleX = image.naturalWidth / Math.max(session.page.viewport.width, 1)
  const scaleY = image.naturalHeight / Math.max(session.page.viewport.height, 1)
  const lineWidth = Math.max(2, Math.round(2 * Math.min(scaleX, scaleY)))
  const labelSize = Math.max(18, Math.round(18 * Math.min(scaleX, scaleY)))
  context.font = `700 ${labelSize}px system-ui, sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  session.targets.forEach((target, index) => {
    const x = Math.max(0, target.rect.x * scaleX)
    const y = Math.max(0, target.rect.y * scaleY)
    const width = Math.max(lineWidth, target.rect.width * scaleX)
    const height = Math.max(lineWidth, target.rect.height * scaleY)
    context.fillStyle = "rgba(34, 197, 94, 0.14)"
    context.fillRect(x, y, width, height)
    context.strokeStyle = "#16a34a"
    context.lineWidth = lineWidth
    context.strokeRect(x, y, width, height)
    const radius = Math.max(13, labelSize * 0.75)
    const centerX = Math.min(image.naturalWidth - radius, Math.max(radius, x + radius))
    const centerY = Math.min(image.naturalHeight - radius, Math.max(radius, y + radius))
    context.beginPath()
    context.arc(centerX, centerY, radius, 0, Math.PI * 2)
    context.fillStyle = "#171b1a"
    context.fill()
    context.fillStyle = "#86efac"
    context.fillText(String(index + 1), centerX, centerY + 1)
  })
  return canvas.toDataURL("image/png")
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.append(textarea)
    textarea.select()
    document.execCommand("copy")
    textarea.remove()
  }
}

function setCompletionBusy(action: "copy" | "copy-link" | "export" | "open-remote" | "reannotate" | null): void {
  state.shadow?.querySelectorAll<HTMLButtonElement>("[data-complete-action], [data-remote-action]").forEach((button) => {
    button.disabled = action !== null
    button.dataset.state = button.dataset.action === action ? "loading" : "default"
  })
}

async function copyReportLink(): Promise<void> {
  const reportUrl = state.completedSession?.remoteArtifacts?.reportUrl
  if (!reportUrl) return
  setCompletionBusy("copy-link")
  setFeedback("")
  try {
    await copyText(reportUrl)
    setFeedback("报告链接已复制，可直接粘贴到公司平台或浏览器打开。", "success")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "报告链接复制失败。", "error")
  } finally {
    setCompletionBusy(null)
  }
}

async function openRemoteReport(): Promise<void> {
  if (!state.sessionId) return
  setCompletionBusy("open-remote")
  setFeedback("")
  try {
    await request({ type: "OPEN_REMOTE_REPORT_FROM_PAGE", sessionId: state.sessionId })
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "远程报告打开失败。", "error")
  } finally {
    setCompletionBusy(null)
  }
}

async function copyContext(): Promise<void> {
  if (!state.sessionId) return
  setCompletionBusy("copy")
  setFeedback("")
  try {
    const markdown = await request<string>({ type: "GET_AI_CONTEXT_FROM_PAGE", sessionId: state.sessionId })
    await copyText(markdown)
    setFeedback("AI 上下文已复制，可直接粘贴到 Codex、Claude 或 Cursor。", "success")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "复制失败。", "error")
  } finally {
    setCompletionBusy(null)
  }
}

async function exportReport(): Promise<void> {
  if (!state.sessionId || !state.completedSession) return
  setCompletionBusy("export")
  setFeedback("")
  try {
    const result = await request<{ directory: string }>({
      type: "EXPORT_FROM_PAGE",
      sessionId: state.sessionId,
    })
    setFeedback(`报告已重新导出到 ${result.directory}。`, "success")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "重新导出失败。", "error")
  } finally {
    setCompletionBusy(null)
  }
}

function openReview(): void {
  if (state.sessionId) send({ type: "OPEN_REVIEW_FROM_PAGE", sessionId: state.sessionId })
}

function hideCompletionOverlay(): void {
  const complete = state.shadow?.querySelector<HTMLElement>("[data-complete]")
  if (complete) complete.hidden = true
  // Keep the runtime listener alive while the background swaps sessions, but
  // remove the visible completion UI immediately so the next capture starts
  // with a clean page.
  if (state.host) state.host.style.display = "none"
}

async function reannotate(): Promise<void> {
  if (!state.sessionId) return
  const previous = state.completedSession
  setCompletionBusy("reannotate")
  setFeedback("")
  hideCompletionOverlay()
  try {
    await request<RootlineSession>({ type: "REANNOTATE_SESSION", sessionId: state.sessionId })
  } catch (error) {
    if (previous) showComplete(previous)
    setFeedback(error instanceof Error ? error.message : "重新标注失败。", "error")
    setCompletionBusy(null)
  }
}

async function finishFromPage(): Promise<void> {
  if (!state.sessionId) return
  if (state.editor) await saveEditor()
  const finish = state.shadow?.querySelector<HTMLButtonElement>("[data-finish]")
  if (finish) {
    finish.disabled = true
    finish.dataset.state = "loading"
    finish.textContent = "正在整理证据并生成截图"
  }
  setFeedback("")
  try {
    await request({ type: "FINISH_FROM_PAGE", sessionId: state.sessionId })
  } catch (error) {
    if (state.host) {
      state.host.style.display = "block"
      state.host.style.visibility = "visible"
    }
    setFeedback(error instanceof Error ? error.message : "采集完成失败。", "error")
    if (finish) {
      finish.disabled = false
      finish.dataset.state = "default"
      finish.textContent = "结束并生成证据"
    }
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function prepareFinish(): Promise<RuntimePrepareFinishResponse> {
  setSelection(false)
  state.finishPrepared = true
  if (state.host) {
    state.host.style.visibility = "hidden"
    state.host.setAttribute("data-capture-hidden", "")
  }
  state.shadow?.querySelector<HTMLElement>("[data-workflow]")?.setAttribute("aria-hidden", "true")
  state.shadow?.querySelector<HTMLElement>("[data-target-layer]")?.setAttribute("hidden", "")
  state.shadow?.querySelector<HTMLElement>("[data-hover-label]")?.setAttribute("hidden", "")
  state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")?.setAttribute("hidden", "")
  state.shadow?.querySelector<HTMLElement>("[data-editor]")?.setAttribute("hidden", "")
  updateHighlight(null)
  await nextPaint()
  await nextPaint()
  return { ok: true, hidden: state.host?.style.visibility === "hidden" }
}

function abortFinish(): void {
  state.finishPrepared = false
  if (state.host) {
    state.host.style.visibility = "visible"
    state.host.removeAttribute("data-capture-hidden")
  }
  state.shadow?.querySelector<HTMLElement>("[data-workflow]")?.removeAttribute("aria-hidden")
  state.shadow?.querySelector<HTMLElement>("[data-target-layer]")?.removeAttribute("hidden")
  const progress = state.shadow?.querySelector<HTMLElement>("[data-finish-progress]")
  if (progress) progress.hidden = true
  syncToolbar()
  syncMarkers()
}

function showFinishProgress(saveMode: CaptureSaveMode): void {
  const host = state.host
  const shadow = state.shadow
  if (!host || !shadow) return
  state.finishPrepared = true
  setSelection(false)
  host.style.display = "block"
  host.style.visibility = "visible"
  shadow.querySelector<HTMLElement>("[data-workflow]")?.removeAttribute("aria-hidden")
  shadow.querySelector<HTMLElement>("[data-workflow]")?.removeAttribute("hidden")
  shadow.querySelector<HTMLElement>("[data-complete]")?.setAttribute("hidden", "")
  const progress = shadow.querySelector<HTMLElement>("[data-finish-progress]")
  const progressText = shadow.querySelector<HTMLElement>("[data-finish-progress-text]")
  if (progressText) {
    progressText.textContent = saveMode === "remote"
      ? "截图已生成，正在上传到腾讯云 COS…"
      : "截图已生成，正在保存到浏览器下载目录…"
  }
  if (progress) progress.hidden = false
  const hint = shadow.querySelector<HTMLElement>("[data-panel-hint]")
  if (hint) hint.textContent = saveMode === "remote"
    ? "截图已完成，正在等待腾讯云 COS 返回结果。"
    : "截图已完成，正在写入本机文件。"
  shadow.querySelectorAll<HTMLButtonElement>("[data-select], [data-mode], [data-undo], [data-clear], [data-cancel], [data-finish]")
    .forEach((button) => { button.disabled = true })
  const finish = shadow.querySelector<HTMLButtonElement>("[data-finish]")
  if (finish) {
    finish.dataset.state = "loading"
    finish.textContent = saveMode === "remote" ? "正在上传证据" : "正在保存证据"
  }
}

function formatProgressBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function updateFinishProgress(progress: import("../src/lib/messaging").RemoteSaveProgress): void {
  const progressText = state.shadow?.querySelector<HTMLElement>("[data-finish-progress-text]")
  const hint = state.shadow?.querySelector<HTMLElement>("[data-panel-hint]")
  const finish = state.shadow?.querySelector<HTMLButtonElement>("[data-finish]")
  const percent = typeof progress.percent === "number"
    ? Math.max(0, Math.min(100, Math.round(progress.percent * 100)))
    : null
  const size = typeof progress.totalBytes === "number" && progress.totalBytes > 0
    ? formatProgressBytes(progress.totalBytes)
    : ""
  const details = [percent === null ? "" : `${percent}%`, size].filter(Boolean).join(" · ")
  const text = progress.stage === "rendering-capture"
    ? "正在生成轻量标注截图…"
    : progress.stage === "uploading-recording"
      ? `正在上传录屏${details ? ` · ${details}` : ""}`
      : progress.stage === "uploading-report"
        ? `正在上传远程报告${details ? ` · ${details}` : ""}`
        : "远程文件已上传，正在保存采集历史…"
  if (progressText) progressText.textContent = text
  if (hint) hint.textContent = text
  if (finish) finish.textContent = progress.stage === "saving-history" ? "正在完成采集" : "正在上传证据"
}

function commitFinish(): void {
  state.abortController?.abort()
  state.abortController = null
  if (state.heartbeatTimer !== null) window.clearInterval(state.heartbeatTimer)
  state.heartbeatTimer = null
  if (state.sessionId) window.postMessage({ source: BRIDGE_SOURCE, type: "cleanup", sessionId: state.sessionId }, "*")
  state.finishPrepared = false
  if (state.host) state.host.style.display = "none"
}

function showComplete(session: RootlineSession): void {
  state.completedSession = session
  if (!state.host || !state.shadow) createOverlay()
  if (state.host) {
    state.host.style.display = "block"
    state.host.style.visibility = "visible"
  }
  const workflow = state.shadow?.querySelector<HTMLElement>("[data-workflow]")
  const targetLayer = state.shadow?.querySelector<HTMLElement>("[data-target-layer]")
  const complete = state.shadow?.querySelector<HTMLElement>("[data-complete]")
  if (workflow) workflow.hidden = true
  if (targetLayer) targetLayer.hidden = true
  state.shadow?.querySelector<HTMLElement>("[data-hover-label]")?.setAttribute("hidden", "")
  state.shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")?.setAttribute("hidden", "")
  state.shadow?.querySelector<HTMLElement>("[data-editor]")?.setAttribute("hidden", "")
  updateHighlight(null)
  if (complete) complete.hidden = false
  const progress = state.shadow?.querySelector<HTMLElement>("[data-finish-progress]")
  if (progress) progress.hidden = true
  const summary = state.shadow?.querySelector<HTMLElement>("[data-complete-summary]")
  if (summary) summary.textContent = `${session.targets.length} 个元素 · ${session.console.length} 条控制台 · ${session.network.length} 条网络`
  const location = state.shadow?.querySelector<HTMLElement>("[data-complete-location]")
  const destination = session.remoteArtifacts?.reportUrl ?? session.localArtifacts?.directoryPath ?? "Chrome 下载目录/Rootline"
  const locationLabel = state.shadow?.querySelector<HTMLElement>("[data-complete-location-label]")
  if (location) location.textContent = destination
  if (locationLabel) locationLabel.textContent = session.remoteArtifacts ? "远程报告链接" : "文件保存位置"
  const remoteActions = state.shadow?.querySelector<HTMLElement>("[data-remote-actions]")
  remoteActions?.toggleAttribute("hidden", !session.remoteArtifacts)
  remoteActions?.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.hidden = !session.remoteArtifacts
  })
  setFeedback(session.remoteArtifacts ? "本次证据已上传到你的腾讯云 COS。" : `本次证据已保存到 ${destination}。`, "success")
  state.shadow?.querySelector<HTMLButtonElement>("[data-open-review]")?.focus()
}

function createOverlay(): void {
  state.host?.remove()
  const host = document.createElement("div")
  host.id = "rootline-runtime-overlay"
  host.style.position = "fixed"
  host.style.inset = "0"
  host.style.setProperty("pointer-events", "none", "important")
  host.style.zIndex = "2147483647"
  const shadow = host.attachShadow({ mode: "open" })
  shadow.innerHTML = `
    <style>
      /* Hallmark · component: runtime annotator · genre: modern-minimal · theme: Crikket interaction reference
       * states: default · hover · focus · active · disabled · loading · error · success
       * contrast: pass
       * Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4
       */
      :host {
        all: initial;
        pointer-events: none !important;
        --rl-ink: #0f172a;
        --rl-copy: #334155;
        --rl-muted: #64748b;
        --rl-faint: #94a3b8;
        --rl-paper: #ffffff;
        --rl-paper-soft: #f1f5f9;
        --rl-rule: rgba(15, 23, 42, .12);
        --rl-rule-strong: rgba(15, 23, 42, .2);
        --rl-accent: #0f766e;
        --rl-accent-bright: #14b8a6;
        --rl-accent-hover: #0d9488;
        --rl-accent-wash: rgba(13, 148, 136, .14);
        --rl-focus: rgba(20, 184, 166, .36);
        --rl-error: #b42318;
        --rl-error-soft: #fff1f0;
        --rl-success: #166534;
        --rl-success-soft: #edfdf3;
        --rl-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --rl-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--rl-ink);
        font: 500 13px/1.45 var(--rl-font);
        letter-spacing: 0;
      }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, textarea { font: inherit; letter-spacing: 0; }
      button { appearance: none; cursor: pointer; white-space: nowrap; }
      button:focus-visible, textarea:focus-visible { outline: 3px solid var(--rl-focus); outline-offset: 2px; }
      button:disabled { cursor: not-allowed; opacity: .42; transform: none !important; }
      .highlight, .target-box { position: fixed; border: 2px solid var(--rl-accent); border-radius: 10px; box-shadow: 0 0 0 2px rgba(255,255,255,.9), 0 14px 38px rgba(15,23,42,.2); pointer-events: none; }
      .highlight { display: none; z-index: 1; background: var(--rl-accent-wash); }
      .highlight[data-pending] { border-color: var(--rl-accent-bright); background: rgba(20,184,166,.2); box-shadow: 0 0 0 3px rgba(255,255,255,.95), 0 0 0 7px rgba(20,184,166,.18), 0 14px 38px rgba(15,23,42,.2); }
      .highlight[data-kind="text-line"] { border-color: #2563eb; background: rgba(37,99,235,.12); }
      .highlight[data-kind="spacing"] { border-color: #ea580c; background: repeating-linear-gradient(45deg, rgba(234,88,12,.16) 0, rgba(234,88,12,.16) 6px, rgba(255,255,255,.18) 6px, rgba(255,255,255,.18) 12px); }
      .hover-label { position: fixed; z-index: 5; width: max-content; min-width: min(260px, calc(100vw - 24px)); max-width: min(560px, calc(100vw - 24px)); padding: 7px 9px; border-radius: 8px; background: rgba(15,23,42,.95); color: #fff; box-shadow: 0 12px 28px rgba(15,23,42,.22); font: 700 11px/1.42 var(--rl-mono); overflow-wrap: anywhere; pointer-events: none; white-space: pre-line; }
      .pending-toolbar { position: fixed; z-index: 6; display: flex; align-items: center; gap: 4px; padding: 4px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(15,23,42,.96); color: #fff; box-shadow: 0 14px 30px rgba(15,23,42,.24); pointer-events: auto; }
      .pending-toolbar button { min-width: 60px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 7px; background: rgba(255,255,255,.1); color: inherit; font-size: 12px; font-weight: 800; }
      .pending-toolbar .confirm-target { background: var(--rl-accent-bright); color: #062c27; }
      .target-box { z-index: 2; background: rgba(13,148,136,.08); cursor: pointer; }
      :host([data-selecting]) .target-box { pointer-events: auto; }
      :host([data-selecting]) .target-box > :not(.target-index) { pointer-events: none; }
      .target-box[data-active="true"] { border-color: var(--rl-accent-hover); box-shadow: 0 0 0 3px rgba(255,255,255,.95), 0 0 0 6px rgba(20,184,166,.22), 0 14px 38px rgba(15,23,42,.2); }
      .target-index { position: absolute; top: -22px; left: -22px; display: grid; place-items: center; width: 44px; height: 44px; min-width: 44px; min-height: 44px; padding: 0; border: 2px solid #fff; border-radius: 999px; background: var(--rl-accent); color: #fff; box-shadow: 0 3px 10px rgba(15,23,42,.25); font-size: 12px; font-weight: 800; pointer-events: auto; }
      .panel { position: fixed; top: 46%; right: 16px; z-index: 4; display: flex; flex-direction: column; gap: 10px; width: 346px; max-width: calc(100vw - 24px); padding: 14px; overflow: hidden; border: 1px solid var(--rl-rule); border-radius: 18px; background: linear-gradient(180deg, rgba(255,255,255,.99), rgba(248,250,252,.98)); color: var(--rl-ink); box-shadow: 0 22px 55px rgba(15,23,42,.22), 0 1px 0 rgba(255,255,255,.88) inset; backdrop-filter: blur(18px); pointer-events: auto; transform: translateY(-50%); transition: left 280ms cubic-bezier(.22,1,.36,1), top 280ms cubic-bezier(.22,1,.36,1), box-shadow 280ms ease; will-change: left, top; }
      .panel::before { content: ""; position: absolute; top: 50%; left: 0; width: ${PANEL_EDGE_HANDLE_WIDTH}px; height: 72px; border-radius: 999px 0 0 999px; background: linear-gradient(180deg, var(--rl-accent), var(--rl-accent-bright)); box-shadow: 0 0 0 3px rgba(20,184,166,.12), 0 10px 24px rgba(15,23,42,.24); opacity: 0; transform: translateY(-50%); transition: opacity 180ms ease; }
      :host([data-panel-edge="left"]) .panel::before { right: 0; left: auto; border-radius: 0 999px 999px 0; }
      :host([data-panel-collapsed]) .panel { border-color: var(--rl-rule); background: var(--rl-paper); box-shadow: 0 10px 24px rgba(15,23,42,.18); backdrop-filter: none; }
      :host([data-panel-collapsed]) .panel::before { opacity: 1; }
      :host([data-panel-collapsed]) .panel > * { opacity: 0; pointer-events: none; transform: translateX(12px); }
      :host([data-panel-dragging]) .panel { transition: opacity 180ms ease, box-shadow 180ms ease; }
      :host([data-panel-dragging]) .panel, :host([data-panel-dragging]) .panel-header { cursor: grabbing; }
      .panel > * { transition: opacity 160ms ease, transform 220ms ease; }
      .panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; cursor: grab; touch-action: none; user-select: none; }
      .title-wrap { min-width: 0; }
      .title { margin: 0; color: var(--rl-ink); font-size: 13px; font-weight: 800; line-height: 1.2; }
      .hint { margin: 4px 0 0; color: #475569; font-size: 11px; line-height: 1.45; }
      .mode-badge { display: inline-flex; align-items: center; flex: 0 0 auto; height: 22px; padding: 0 8px; border-radius: 999px; background: var(--rl-ink); color: #fff; font-size: 11px; font-weight: 700; }
      .mode-badge[data-recording] { background: var(--rl-error); }
      .recording-strip { display: grid; grid-template-columns: 10px minmax(0,1fr) auto auto; align-items: center; gap: 8px; min-height: 44px; border: 1px solid rgba(180,35,24,.2); border-radius: 11px; padding: 5px 6px 5px 10px; background: var(--rl-error-soft); color: var(--rl-error); }
      .recording-strip[data-status="stopped"] { border-color: var(--rl-rule); background: var(--rl-paper-soft); color: var(--rl-copy); }
      .recording-strip[data-status="failed"] { border-color: rgba(180,35,24,.34); }
      .recording-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px rgba(180,35,24,.1); }
      .recording-strip[data-status="recording"] .recording-dot { animation: pulse 1.4s ease-in-out infinite; }
      .recording-label { overflow: hidden; font-size: 11px; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
      .recording-time { font: 700 11px/1 var(--rl-mono); }
      .recording-stop { min-width: 52px; min-height: 34px; border: 1px solid rgba(180,35,24,.24); border-radius: 8px; background: #fff; color: var(--rl-error); font-size: 11px; font-weight: 800; }
      .shortcut { display: flex; align-items: center; gap: 6px; margin: -2px 2px 0; color: #475569; font-size: 11px; line-height: 1.3; }
      .shortcut-key { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px; border: 1px solid var(--rl-rule-strong); border-bottom-color: rgba(15,23,42,.3); border-radius: 5px; background: #fff; color: var(--rl-ink); font-size: 10px; font-weight: 800; }
      .shortcut-action { color: var(--rl-copy); font-weight: 700; }
      .select-button { display: flex; align-items: center; justify-content: flex-start; width: 100%; min-height: 58px; padding: 10px 12px; border: 1px solid rgba(15,23,42,.16); border-radius: 14px; background: var(--rl-ink); color: #fff; box-shadow: 0 14px 28px rgba(15,23,42,.2); text-align: left; }
      .select-button[data-active="true"] { border-color: rgba(13,148,136,.42); background: var(--rl-accent); box-shadow: 0 16px 34px rgba(13,148,136,.28); }
      .select-copy { display: grid; gap: 3px; }
      .select-label { font-size: 13px; font-weight: 800; line-height: 1.1; }
      .select-detail { color: rgba(255,255,255,.74); font-size: 10px; font-weight: 600; line-height: 1.25; white-space: normal; }
      .selection-modes { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4px; padding: 4px; border: 1px solid rgba(15,23,42,.08); border-radius: 14px; background: rgba(241,245,249,.88); }
      .mode-button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 52px; padding: 6px 7px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: #475569; text-align: center; }
      .mode-button[data-active] { border-color: var(--rl-rule); background: #fff; color: var(--rl-accent); box-shadow: 0 8px 18px rgba(15,23,42,.1); }
      .mode-label { font-size: 12px; font-weight: 800; line-height: 1.1; }
      .mode-detail { color: var(--rl-muted); font-size: 10px; font-weight: 600; line-height: 1.2; white-space: normal; }
      .mode-button[data-active] .mode-detail { color: var(--rl-accent); }
      .count-wrap { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 0 10px; border: 1px solid rgba(15,23,42,.08); border-radius: 12px; background: rgba(241,245,249,.86); color: var(--rl-copy); font-size: 11px; }
      .count { color: var(--rl-ink); font-weight: 800; }
      .tools { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 6px; }
      .tool-button { min-height: 44px; min-width: 0; padding: 0 7px; border: 1px solid rgba(15,23,42,.1); border-radius: 12px; background: rgba(255,255,255,.78); color: var(--rl-ink); font-size: 11px; font-weight: 750; }
      .finish-button { width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid rgba(15,118,110,.3); border-radius: 12px; background: var(--rl-accent); color: #fff; font-size: 12px; font-weight: 800; box-shadow: 0 12px 24px rgba(15,118,110,.2); }
      button[data-state="loading"] { cursor: wait; }
      button[data-state="loading"]::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 7px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: -2px; animation: spin .7s linear infinite; }
      .editor { position: fixed; z-index: 7; display: grid; gap: 10px; width: min(320px, calc(100vw - 24px)); padding: 14px; border: 1px solid var(--rl-rule); border-radius: 14px; background: rgba(255,255,255,.99); color: var(--rl-ink); box-shadow: 0 18px 46px rgba(15,23,42,.2), 0 1px 0 rgba(255,255,255,.9) inset; pointer-events: auto; }
      .field { display: grid; gap: 5px; }
      .field-head { display: flex; align-items: center; justify-content: space-between; color: #475569; font-size: 11px; font-weight: 700; line-height: 1.2; }
      .field-count { color: var(--rl-faint); }
      textarea { width: 100%; min-height: 78px; padding: 10px 11px; resize: vertical; border: 1px solid var(--rl-rule); border-radius: 10px; outline: 3px solid transparent; outline-offset: 1px; background: rgba(255,255,255,.92); color: var(--rl-ink); font-size: 12px; line-height: 1.45; }
      textarea::placeholder { color: var(--rl-faint); }
      .editor-actions { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 6px; }
      .editor-actions button { min-height: 44px; padding: 0 10px; border: 1px solid var(--rl-rule); border-radius: 10px; background: #fff; color: var(--rl-ink); font-size: 12px; font-weight: 800; }
      .editor-actions .danger { color: var(--rl-error); }
      .editor-actions .confirm { border-color: rgba(15,118,110,.3); background: var(--rl-accent); color: #fff; }
      .feedback { border: 1px solid var(--rl-rule); border-radius: 10px; padding: 10px 12px; background: #fff; color: var(--rl-copy); box-shadow: 0 12px 28px rgba(15,23,42,.16); }
      .workflow-feedback { position: fixed; right: 16px; bottom: 16px; z-index: 8; max-width: min(420px, calc(100vw - 32px)); pointer-events: none; }
      .feedback[data-tone="success"] { border-color: rgba(22,101,52,.28); background: var(--rl-success-soft); color: var(--rl-success); }
      .feedback[data-tone="error"] { border-color: rgba(180,35,24,.28); background: var(--rl-error-soft); color: var(--rl-error); }
      .finish-progress { display: flex; align-items: center; gap: 9px; margin-top: 12px; border: 1px solid rgba(15,118,110,.22); border-radius: 10px; padding: 10px 12px; background: #ecfeff; color: #115e59; font-size: 12px; line-height: 1.45; }
      .finish-progress[hidden] { display: none; }
      .finish-progress::before { content: ""; width: 13px; height: 13px; flex: none; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
      .complete { position: fixed; right: 16px; bottom: 16px; z-index: 9; display: grid; width: min(390px, calc(100vw - 32px)); gap: 14px; padding: 16px; border: 1px solid var(--rl-rule); border-radius: 8px; background: #fff; box-shadow: 0 14px 36px rgba(15,23,42,.18); pointer-events: auto; }
      .complete-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .eyebrow { margin: 0 0 3px; color: var(--rl-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
      .complete-title { margin: 0; font-size: 15px; font-weight: 800; line-height: 1.3; }
      .complete-summary { margin: 0; color: var(--rl-muted); }
      .complete-location { display: grid; gap: 4px; margin: 0; padding: 10px 11px; border: 1px solid var(--rl-rule); border-radius: 6px; background: var(--rl-paper-soft); }
      .complete-location span { color: var(--rl-muted); font-size: 11px; font-weight: 700; }
      .complete-location code { color: var(--rl-ink); font: 600 11px/1.45 var(--rl-mono); overflow-wrap: anywhere; }
      .complete-actions, .remote-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .complete-actions button, .remote-actions button { min-height: 44px; padding: 0 12px; border: 1px solid var(--rl-rule); border-radius: 6px; background: #fff; color: var(--rl-ink); font-size: 13px; font-weight: 700; }
      .complete-actions .primary, .remote-actions .primary { border-color: rgba(15,118,110,.3); background: var(--rl-accent); color: #fff; }
      @media (hover: hover) and (pointer: fine) {
        .pending-toolbar button:hover:not(:disabled) { background: rgba(255,255,255,.18); }
        .pending-toolbar .confirm-target:hover:not(:disabled) { background: var(--rl-accent-hover); color: #fff; }
        .select-button:hover:not(:disabled) { border-color: rgba(15,23,42,.16); background: #1e293b; color: #fff; }
        .select-button[data-active="true"]:hover:not(:disabled) { border-color: rgba(13,148,136,.42); background: var(--rl-accent); color: #fff; }
        .mode-button:hover:not(:disabled) { border-color: var(--rl-rule); background: rgba(255,255,255,.7); color: var(--rl-copy); }
        .mode-button[data-active]:hover:not(:disabled) { border-color: var(--rl-rule); background: #fff; color: var(--rl-accent); }
        .tool-button:hover:not(:disabled) { border-color: var(--rl-rule-strong); background: #fff; color: var(--rl-ink); }
        .finish-button:hover:not(:disabled), .editor-actions .confirm:hover:not(:disabled), .complete-actions .primary:hover:not(:disabled), .remote-actions .primary:hover:not(:disabled) { border-color: rgba(13,148,136,.5); background: var(--rl-accent-hover); color: #fff; }
        .editor-actions .danger:hover:not(:disabled) { border-color: rgba(180,35,24,.28); background: var(--rl-error-soft); color: var(--rl-error); }
        .target-index:hover:not(:disabled) { border-color: #fff; background: var(--rl-accent-hover); color: #fff; }
        textarea:hover { background: var(--rl-paper-soft); }
      }
      button:active:not(:disabled) { transform: translateY(1px); }
      @media (max-width: 560px) {
        .panel { max-height: calc(100vh - 24px); overflow-y: auto; }
        .pending-toolbar { left: 8px !important; max-width: calc(100vw - 16px); }
        .editor { right: 8px; bottom: 8px; left: 8px !important; top: auto !important; width: auto !important; max-height: calc(100vh - 16px); overflow-y: auto; }
        .complete { right: 8px; bottom: 8px; left: 8px; width: auto; }
        .workflow-feedback { right: 8px; bottom: 8px; left: 8px; max-width: none; }
      }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 50% { opacity: .38; transform: scale(.82); } }
    </style>
    <div class="highlight" data-highlight></div>
    <div class="hover-label" data-hover-label hidden></div>
    <div data-target-layer></div>
    <div aria-label="确认当前元素" class="pending-toolbar" data-pending-toolbar role="toolbar" hidden>
      <button data-select-parent type="button">父级</button>
      <button class="confirm-target" data-confirm-target type="button">标注</button>
      <button data-reselect-target type="button">重选</button>
    </div>
    <section aria-label="Rootline 页面采集工具" class="panel" data-panel data-workflow>
      <header class="panel-header" data-panel-drag-handle>
        <div class="title-wrap"><p class="title">标注区域</p><p class="hint" data-panel-hint></p></div>
        <span class="mode-badge" data-capture-mode>截图</span>
      </header>
      <div aria-live="polite" class="recording-strip" data-recording-strip hidden><span aria-hidden="true" class="recording-dot"></span><span class="recording-label" data-recording-label></span><code class="recording-time" data-recording-time>00:00</code><button class="recording-stop" data-stop-recording type="button">停止</button></div>
      <button class="select-button" data-select type="button">
        <span class="select-copy"><span class="select-label" data-select-label>开始标注</span><span class="select-detail" data-select-detail>选择页面上的问题位置</span></span>
      </button>
      <div class="shortcut" aria-label="按 A 开始标注"><span class="shortcut-key">A</span><span>快捷键</span><span class="shortcut-action" data-shortcut-action>开始标注</span></div>
      <div class="selection-modes" role="group" aria-label="标注模式">
        <button class="mode-button" data-mode="element" type="button"><span class="mode-label">控件</span><span class="mode-detail">按钮、表单和页面元素</span></button>
        <button class="mode-button" data-mode="spacing" type="button"><span class="mode-label">间距</span><span class="mode-detail">空白距离和文字行</span></button>
      </div>
      <div class="count-wrap"><span>已标注</span><span class="count"><span data-count>0</span> / ${MAX_TARGETS}</span></div>
      <div class="tools">
        <button class="tool-button" data-undo type="button">撤销</button>
        <button class="tool-button" data-clear type="button">清空</button>
        <button class="tool-button" data-cancel type="button">取消</button>
      </div>
      <div aria-live="polite" class="finish-progress" data-finish-progress hidden><span data-finish-progress-text></span></div>
      <button class="finish-button" data-finish type="button">完成并截图</button>
    </section>
    <section aria-label="元素问题标注" class="editor" data-editor hidden>
      <label class="field"><span class="field-head"><span>预期结果</span><span class="field-count" data-expected-count>0/${ISSUE_TEXT_MAX_LENGTH}</span></span><textarea data-expected maxlength="${ISSUE_TEXT_MAX_LENGTH}" placeholder="这个位置本来应该怎样表现？"></textarea></label>
      <label class="field"><span class="field-head"><span>实际结果</span><span class="field-count" data-actual-count>0/${ISSUE_TEXT_MAX_LENGTH}</span></span><textarea data-actual maxlength="${ISSUE_TEXT_MAX_LENGTH}" placeholder="页面上实际发生了什么？"></textarea></label>
      <div class="editor-actions"><button class="danger" data-remove-annotation type="button">删除标注</button><button class="confirm" data-save-annotation type="button">确定</button></div>
    </section>
    <section aria-label="采集完成" class="complete" data-complete hidden>
      <div class="complete-head"><div><p class="eyebrow">采集完成</p><h2 class="complete-title">本次证据已生成</h2></div></div>
      <p class="complete-summary" data-complete-summary></p>
      <p class="complete-location"><span data-complete-location-label>文件保存位置</span><code data-complete-location>Chrome 下载目录/Rootline</code></p>
      <div aria-live="polite" class="feedback" data-complete-feedback hidden></div>
      <div class="complete-actions"><button class="primary" data-action="review" data-complete-action data-open-review type="button">查看本次完整证据</button><button data-action="reannotate" data-complete-action data-reannotate type="button">重新标注</button><button data-action="copy" data-complete-action data-copy-context type="button">复制 AI 上下文</button><button data-action="export" data-complete-action data-export-report type="button">重新导出报告</button></div>
      <div class="remote-actions" data-remote-actions hidden><button class="primary" data-action="open-remote" data-remote-action data-open-remote-report hidden type="button">打开远程报告</button><button data-action="copy-link" data-remote-action data-copy-report-link hidden type="button">复制报告链接</button></div>
    </section>
    <div aria-live="polite" class="feedback workflow-feedback" data-workflow-feedback hidden></div>`
  document.documentElement.append(host)
  state.host = host
  state.shadow = shadow
  state.highlight = shadow.querySelector("[data-highlight]")
  shadow.querySelector("[data-select]")?.addEventListener("click", () => setSelection(!state.selectionEnabled))
  shadow.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setSelectionMode(button.dataset.mode === "spacing" ? "spacing" : "element"))
  })
  shadow.querySelector("[data-undo]")?.addEventListener("click", undoLastTarget)
  shadow.querySelector("[data-clear]")?.addEventListener("click", clearTargets)
  shadow.querySelector("[data-cancel]")?.addEventListener("click", () => {
    if (state.sessionId) send({ type: "DISCARD_SESSION", sessionId: state.sessionId })
  })
  shadow.querySelector("[data-finish]")?.addEventListener("click", () => void finishFromPage())
  shadow.querySelector("[data-stop-recording]")?.addEventListener("click", () => void stopRecordingFromPage())
  shadow.querySelector("[data-select-parent]")?.addEventListener("click", promotePendingTargetToParent)
  shadow.querySelector("[data-confirm-target]")?.addEventListener("click", () => {
    const target = state.pendingTarget
    if (target) void selectRuntimeTarget(target)
  })
  shadow.querySelector("[data-reselect-target]")?.addEventListener("click", reselectPendingTarget)
  const actual = shadow.querySelector<HTMLTextAreaElement>("[data-actual]")
  const expected = shadow.querySelector<HTMLTextAreaElement>("[data-expected]")
  for (const field of [actual, expected]) {
    field?.addEventListener("input", updateCounters)
    field?.addEventListener("focus", () => {
      state.editorPinned = true
      clearEditorHideTimer()
    })
  }
  const editor = shadow.querySelector<HTMLElement>("[data-editor]")
  editor?.addEventListener("pointerenter", clearEditorHideTimer)
  editor?.addEventListener("pointerleave", scheduleEditorHide)
  shadow.querySelector("[data-save-annotation]")?.addEventListener("click", () => void saveEditor())
  shadow.querySelector("[data-remove-annotation]")?.addEventListener("click", removeEditedTarget)
  shadow.querySelector("[data-copy-context]")?.addEventListener("click", () => void copyContext())
  shadow.querySelector("[data-copy-report-link]")?.addEventListener("click", () => void copyReportLink())
  shadow.querySelector("[data-export-report]")?.addEventListener("click", () => void exportReport())
  shadow.querySelector("[data-open-review]")?.addEventListener("click", openReview)
  shadow.querySelector("[data-open-remote-report]")?.addEventListener("click", () => void openRemoteReport())
  shadow.querySelector("[data-reannotate]")?.addEventListener("click", () => void reannotate())
  const panel = shadow.querySelector<HTMLElement>("[data-panel]")
  const dragHandle = shadow.querySelector<HTMLElement>("[data-panel-drag-handle]")
  dragHandle?.addEventListener("pointerdown", startPanelDrag)
  panel?.addEventListener("pointermove", updatePanelDrag)
  panel?.addEventListener("pointerup", finishPanelDrag)
  panel?.addEventListener("pointercancel", finishPanelDrag)
  panel?.addEventListener("pointerenter", activatePanel)
  panel?.addEventListener("pointerleave", () => schedulePanelIdle(PANEL_LEAVE_IDLE_DELAY_MS))
  void initializePanelPosition()
}

function cleanup(): void {
  setSelection(false)
  removePanelDragListeners()
  clearEditorHideTimer()
  clearPanelIdleTimer()
  state.abortController?.abort()
  state.abortController = null
  if (state.heartbeatTimer !== null) window.clearInterval(state.heartbeatTimer)
  state.heartbeatTimer = null
  if (state.feedbackTimer !== null) window.clearTimeout(state.feedbackTimer)
  state.feedbackTimer = null
  clearRecordingTimer()
  state.host?.remove()
  state.host = null
  state.shadow = null
  state.highlight = null
  state.selectedElements.clear()
  state.selectedTargets.clear()
  state.pendingTarget = null
  state.hoveredTarget = null
  state.editor = null
  state.editorPinned = false
  state.editorReopenTargetId = null
  state.panelDockEdge = null
  state.panelDrag = null
  state.completedSession = null
  state.finishPrepared = false
  state.recordingState = null
  state.recording = null
  if (state.sessionId) window.postMessage({ source: BRIDGE_SOURCE, type: "cleanup", sessionId: state.sessionId }, "*")
  state.sessionId = null
  state.startedAt = null
  state.originalCursor = null
}

function start(message: Extract<TabRuntimeRequest, { type: "ROOTLINE_START" }>): RuntimeStartResponse {
  if (state.sessionId === message.sessionId) {
    state.recordingState = message.recordingState ?? null
    state.recording = message.recording ?? null
    message.targets.forEach((target) => {
      state.selectedTargets.set(target.id, target)
      try {
        const element = document.querySelector(target.selector)
        if (element) state.selectedElements.set(target.id, element)
      } catch {
        // A stale or browser-specific selector still remains useful as report evidence.
      }
    })
    syncToolbar()
    syncMarkers()
    send({ type: "RUNTIME_READY", sessionId: message.sessionId, page: pageInfo() })
    return { ok: true, visible: state.host?.style.display !== "none" }
  }
  cleanup()
  state.sessionId = message.sessionId
  state.startedAt = message.startedAt
  state.recordingState = message.recordingState ?? null
  state.recording = message.recording ?? null
  state.originalCursor = document.documentElement.style.cursor
  message.targets.forEach((target) => {
    state.selectedTargets.set(target.id, target)
    try {
      const element = document.querySelector(target.selector)
      if (element) state.selectedElements.set(target.id, element)
    } catch {
      // A stale or browser-specific selector still remains useful as report evidence.
    }
  })
  state.abortController = new AbortController()
  state.heartbeatTimer = window.setInterval(() => {
    const sessionId = state.sessionId
    if (!sessionId) return
    void chrome.runtime.sendMessage({ type: "RUNTIME_HEARTBEAT", sessionId } satisfies ExtensionRequest)
      .then((response: { ok?: boolean } | undefined) => {
        if (!response?.ok) {
          cleanup()
          return
        }
        window.postMessage({ source: BRIDGE_SOURCE, type: "heartbeat", sessionId }, "*")
      })
      .catch(() => cleanup())
  }, 2_000)
  installSelectionListeners(state.abortController)
  createOverlay()
  syncToolbar()
  syncMarkers()
  window.postMessage({ source: BRIDGE_SOURCE, type: "start", sessionId: message.sessionId, startedAt: message.startedAt }, "*")
  send({ type: "RUNTIME_READY", sessionId: message.sessionId, page: pageInfo() })
  return { ok: true, visible: state.host?.style.display !== "none" }
}

function snapshot(): RuntimeSnapshotResponse {
  const targets = Array.from(state.selectedTargets.values()).map(targetRect)
  return { ok: true, page: pageInfo(), resources: resourceEvidence(), targets }
}

function installBridge(): void {
  if (globalThis.__ROOTLINE_BRIDGE_INSTALLED__) return
  globalThis.__ROOTLINE_BRIDGE_INSTALLED__ = true
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.source !== RUNTIME_SOURCE ||
      event.data?.type !== "event" ||
      event.data?.sessionId !== state.sessionId
    ) return
    const payload = event.data.event
    if (!payload || typeof payload !== "object" || !state.sessionId) return
    if (isConsoleEvidence(payload)) send({ type: "RUNTIME_EVENTS", sessionId: state.sessionId, console: [payload], network: [] })
    else if (isNetworkEvidence(payload)) send({ type: "RUNTIME_EVENTS", sessionId: state.sessionId, console: [], network: [payload] })
  })
  chrome.runtime.onMessage.addListener((message: TabRuntimeRequest, _sender, sendResponse) => {
    if (message.type === "ROOTLINE_START") sendResponse(start(message))
    if (message.type === "ROOTLINE_SET_SELECTION") setSelection(message.enabled)
    if (message.type === "ROOTLINE_CAPTURE_SNAPSHOT") sendResponse(snapshot())
    if (message.type === "ROOTLINE_PREPARE_FINISH") {
      void prepareFinish().then(sendResponse)
      return true
    }
    if (message.type === "ROOTLINE_SHOW_FINISH_PROGRESS") showFinishProgress(message.saveMode)
    if (message.type === "ROOTLINE_UPDATE_FINISH_PROGRESS") updateFinishProgress(message.progress)
    if (message.type === "ROOTLINE_ABORT_FINISH") abortFinish()
    if (message.type === "ROOTLINE_COMMIT_FINISH") commitFinish()
    if (message.type === "ROOTLINE_SHOW_COMPLETE") showComplete(message.session)
    if (message.type === "ROOTLINE_RECORDING_STATE") {
      state.recordingState = message.recordingState ?? null
      state.recording = message.recording ?? null
      syncToolbar()
    }
    if (message.type === "ROOTLINE_CLEANUP") cleanup()
    return message.type === "ROOTLINE_CAPTURE_SNAPSHOT" || message.type === "ROOTLINE_START"
  })
}

export default defineUnlistedScript(() => installBridge())
