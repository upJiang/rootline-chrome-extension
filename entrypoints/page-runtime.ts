import { redactBody, redactHeaders, redactText, redactUrl, truncateText } from "../src/lib/redaction"
import type { ConsoleEvidence, NetworkEvidence, ReactRuntimeHint } from "../src/lib/types"
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"

interface XhrMeta {
  method: string
  url: string
  started: number
  timestamp: string
  body?: string
  requestHeaders: Record<string, string>
}

interface RootlineRuntimeState {
  sessionId: string | null
  startedAt: string | null
  originalConsole: Partial<Record<ConsoleEvidence["level"], (...args: unknown[]) => void>>
  originalFetch: typeof window.fetch
  originalXhrOpen: typeof XMLHttpRequest.prototype.open
  originalXhrSend: typeof XMLHttpRequest.prototype.send
  teardown: Array<() => void>
  lastHeartbeatAt: number
}

interface NamedFunction extends Function {
  displayName?: string
}

declare global {
  interface Window {
    __ROOTLINE_RUNTIME_STATE__?: RootlineRuntimeState
  }
}

const SOURCE = "rootline-runtime"
const CONSOLE_LIMIT = 4 * 1024
const REQUEST_LIMIT = 8 * 1024
const RESPONSE_LIMIT = 16 * 1024

function serializeValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`
  if (typeof value === "string") return redactText(value)
  try {
    return redactText(JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return `${nested.toString()}n`
      if (nested instanceof Error) return { name: nested.name, message: nested.message, stack: nested.stack }
      if (nested instanceof Element) return `<${nested.tagName.toLowerCase()}>`
      return nested
    }))
  } catch {
    return redactText(String(value))
  }
}

function postEvent(event: ConsoleEvidence | NetworkEvidence): void {
  const sessionId = window.__ROOTLINE_RUNTIME_STATE__?.sessionId
  if (!sessionId) return
  window.postMessage({ source: SOURCE, type: "event", sessionId, event }, "*")
}

function headersToRecord(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined
  try {
    return redactHeaders(Object.fromEntries(new Headers(headers).entries()))
  } catch {
    return undefined
  }
}

function headerContentType(headers?: Record<string, string>): string {
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === "content-type")
  return entry?.[1] ?? ""
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (typeof init?.body === "string") return init.body
  if (init?.body instanceof URLSearchParams) return init.body.toString()
  if (input instanceof Request) {
    try {
      return await input.clone().text()
    } catch {
      return undefined
    }
  }
  return undefined
}

async function responsePreview(response: Response): Promise<string | undefined> {
  const type = response.headers.get("content-type") ?? ""
  if (!/(?:json|text|javascript|xml|html|css|form)/i.test(type)) return undefined
  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (contentLength > 2 * 1024 * 1024) return `[BODY OMITTED: ${contentLength} BYTES]`
  try {
    return await response.clone().text()
  } catch {
    return undefined
  }
}

function installConsole(state: RootlineRuntimeState): void {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console)
    state.originalConsole[level] = original
    console[level] = (...args: unknown[]) => {
      original(...args)
      const serialized = truncateText(args.map(serializeValue).join(" "), CONSOLE_LIMIT)
      const error = args.find((item): item is Error => item instanceof Error)
      postEvent({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        level,
        message: serialized.value,
        ...(error?.stack ? { stack: truncateText(redactText(error.stack), CONSOLE_LIMIT).value } : {}),
        ...(serialized.truncated ? { truncated: true } : {}),
      })
    }
  }
}

function installGlobalErrors(state: RootlineRuntimeState): void {
  const onError = (event: ErrorEvent) => {
    const message = truncateText(redactText(event.message || "Unhandled page error"), CONSOLE_LIMIT)
    postEvent({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "error",
      message: message.value,
      ...(event.error?.stack ? { stack: truncateText(redactText(String(event.error.stack)), CONSOLE_LIMIT).value } : {}),
      ...(message.truncated ? { truncated: true } : {}),
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    const message = truncateText(`Unhandled rejection: ${serializeValue(event.reason)}`, CONSOLE_LIMIT)
    postEvent({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level: "error",
      message: message.value,
      ...(event.reason instanceof Error && event.reason.stack
        ? { stack: truncateText(redactText(event.reason.stack), CONSOLE_LIMIT).value }
        : {}),
      ...(message.truncated ? { truncated: true } : {}),
    })
  }
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  state.teardown.push(() => window.removeEventListener("error", onError))
  state.teardown.push(() => window.removeEventListener("unhandledrejection", onRejection))
}

function installFetch(state: RootlineRuntimeState): void {
  const original = state.originalFetch
  window.fetch = async (input, init) => {
    const started = performance.now()
    const timestamp = new Date().toISOString()
    const url = redactUrl(input instanceof Request ? input.url : String(input))
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    const inputHeaders = headersToRecord(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const rawRequestBody = await requestBody(input, init)
    const sanitizedRequest = rawRequestBody
      ? truncateText(redactBody(rawRequestBody, headerContentType(inputHeaders)) ?? "", REQUEST_LIMIT)
      : null
    try {
      const response = await original.call(window, input, init)
      const responseHeaders = headersToRecord(response.headers)
      const rawResponseBody = await responsePreview(response)
      const sanitizedResponse = rawResponseBody
        ? truncateText(redactBody(rawResponseBody, response.headers.get("content-type") ?? "") ?? "", RESPONSE_LIMIT)
        : null
      postEvent({
        id: crypto.randomUUID(),
        timestamp,
        method,
        url,
        type: "fetch",
        status: response.status,
        duration: performance.now() - started,
        ...(inputHeaders ? { requestHeaders: inputHeaders } : {}),
        ...(responseHeaders ? { responseHeaders } : {}),
        ...(sanitizedRequest ? { requestBody: sanitizedRequest.value, requestBodyTruncated: sanitizedRequest.truncated } : {}),
        ...(sanitizedResponse ? { responseBody: sanitizedResponse.value, responseBodyTruncated: sanitizedResponse.truncated } : {}),
      })
      return response
    } catch (error) {
      postEvent({
        id: crypto.randomUUID(),
        timestamp,
        method,
        url,
        type: "fetch",
        duration: performance.now() - started,
        error: truncateText(redactText(error instanceof Error ? error.message : String(error)), 1_000).value,
        ...(inputHeaders ? { requestHeaders: inputHeaders } : {}),
        ...(sanitizedRequest ? { requestBody: sanitizedRequest.value, requestBodyTruncated: sanitizedRequest.truncated } : {}),
      })
      throw error
    }
  }
}

function installXhr(state: RootlineRuntimeState): void {
  const meta = new WeakMap<XMLHttpRequest, XhrMeta>()
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
  XMLHttpRequest.prototype.open = function rootlineOpen(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    meta.set(this, {
      method: String(method).toUpperCase(),
      url: redactUrl(String(url)),
      started: 0,
      timestamp: new Date().toISOString(),
      requestHeaders: {},
    })
    if (typeof async === "boolean") {
      Reflect.apply(state.originalXhrOpen, this, [method, url, async, username, password])
      return
    }
    Reflect.apply(state.originalXhrOpen, this, [method, url])
  }
  XMLHttpRequest.prototype.setRequestHeader = function rootlineSetRequestHeader(name, value) {
    const current = meta.get(this)
    if (current) current.requestHeaders[name] = value
    originalSetRequestHeader.call(this, name, value)
  }
  XMLHttpRequest.prototype.send = function rootlineSend(body) {
    const current = meta.get(this)
    if (current) {
      current.started = performance.now()
      if (typeof body === "string") current.body = truncateText(redactBody(body) ?? "", REQUEST_LIMIT).value
      const onLoadEnd = () => {
        let responseBody: string | undefined
        try {
          if (this.responseType === "" || this.responseType === "text") responseBody = this.responseText
          else if (this.responseType === "json") responseBody = JSON.stringify(this.response)
        } catch {
          responseBody = undefined
        }
        const preview = responseBody
          ? truncateText(redactBody(responseBody, this.getResponseHeader("content-type") ?? "") ?? "", RESPONSE_LIMIT)
          : null
        const responseHeaders = Object.fromEntries(
          this.getAllResponseHeaders()
            .trim()
            .split(/[\r\n]+/)
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf(":")
              return separator === -1 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
            }),
        )
        postEvent({
          id: crypto.randomUUID(),
          timestamp: current.timestamp,
          method: current.method,
          url: current.url,
          type: "xhr",
          status: this.status,
          duration: performance.now() - current.started,
          ...(redactHeaders(current.requestHeaders) ? { requestHeaders: redactHeaders(current.requestHeaders)! } : {}),
          ...(redactHeaders(responseHeaders) ? { responseHeaders: redactHeaders(responseHeaders)! } : {}),
          ...(current.body ? { requestBody: current.body } : {}),
          ...(preview ? { responseBody: preview.value, responseBodyTruncated: preview.truncated } : {}),
        })
      }
      this.addEventListener("loadend", onLoadEnd, { once: true })
    }
    return state.originalXhrSend.call(this, body)
  }
  state.teardown.push(() => {
    XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader
  })
}

function componentName(fiber: Record<string, unknown>): string | null {
  const type = fiber.elementType ?? fiber.type
  if (typeof type === "string") return null
  if (typeof type === "function") {
    const named = type as NamedFunction
    return named.displayName || named.name || null
  }
  if (type && typeof type === "object") {
    const record = type as Record<string, unknown>
    if (typeof record.displayName === "string") return record.displayName
    const nested = record.type
    if (typeof nested === "function") {
      const named = nested as NamedFunction
      return named.displayName || named.name || null
    }
    const render = record.render
    if (typeof render === "function") {
      const named = render as NamedFunction
      return named.displayName || named.name || null
    }
  }
  return null
}

function inspectReact(element: Element): ReactRuntimeHint {
  const keys = Object.keys(element as unknown as Record<string, unknown>)
  const fiberKey = keys.find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"))
  const propsKey = keys.find((key) => key.startsWith("__reactProps$"))
  const componentChain: string[] = []
  const propsKeys = new Set<string>()
  const directProps = propsKey ? (element as unknown as Record<string, unknown>)[propsKey] : null
  if (directProps && typeof directProps === "object") {
    for (const key of Object.keys(directProps as Record<string, unknown>)) if (key !== "children") propsKeys.add(key)
  }
  let fiber = fiberKey ? (element as unknown as Record<string, unknown>)[fiberKey] : null
  let depth = 0
  while (fiber && typeof fiber === "object" && depth < 12) {
    const record = fiber as Record<string, unknown>
    const name = componentName(record)
    if (name && !componentChain.includes(name)) componentChain.push(name)
    const props = record.memoizedProps
    if (props && typeof props === "object") {
      for (const key of Object.keys(props as Record<string, unknown>)) if (key !== "children") propsKeys.add(key)
    }
    fiber = record.return
    depth += 1
  }
  return {
    available: Boolean(fiberKey),
    componentChain,
    propsKeys: Array.from(propsKeys).slice(0, 40),
    ...(!fiberKey ? { boundary: "当前元素未暴露 React Fiber；生产构建或非 React 页面会出现此情况。" } : {}),
  }
}

function restore(state: RootlineRuntimeState): void {
  for (const [level, original] of Object.entries(state.originalConsole)) {
    if (original) console[level as ConsoleEvidence["level"]] = original
  }
  window.fetch = state.originalFetch
  XMLHttpRequest.prototype.open = state.originalXhrOpen
  XMLHttpRequest.prototype.send = state.originalXhrSend
  for (const teardown of state.teardown) teardown()
  state.sessionId = null
  state.startedAt = null
  delete window.__ROOTLINE_RUNTIME_STATE__
}

function install(): void {
  if (window.__ROOTLINE_RUNTIME_STATE__) return
  const state: RootlineRuntimeState = {
    sessionId: null,
    startedAt: null,
    originalConsole: {},
    originalFetch: window.fetch,
    originalXhrOpen: XMLHttpRequest.prototype.open,
    originalXhrSend: XMLHttpRequest.prototype.send,
    teardown: [],
    lastHeartbeatAt: Date.now(),
  }
  window.__ROOTLINE_RUNTIME_STATE__ = state
  installConsole(state)
  installGlobalErrors(state)
  installFetch(state)
  installXhr(state)

  const onBridgeMessage = (event: MessageEvent) => {
    if (event.source !== window || !event.data || event.data.source !== "rootline-bridge") return
    const payload = event.data as Record<string, unknown>
    if (payload.type === "start" && typeof payload.sessionId === "string") {
      state.sessionId = payload.sessionId
      state.startedAt = typeof payload.startedAt === "string" ? payload.startedAt : new Date().toISOString()
      state.lastHeartbeatAt = Date.now()
      return
    }
    if (payload.type === "heartbeat" && payload.sessionId === state.sessionId) {
      state.lastHeartbeatAt = Date.now()
      return
    }
    if (payload.type === "inspect-react" && typeof payload.targetId === "string" && typeof payload.requestId === "string") {
      const element = document.querySelector(`[data-rootline-target-id="${CSS.escape(payload.targetId)}"]`)
      window.postMessage({
        source: SOURCE,
        type: "react-hint",
        sessionId: state.sessionId,
        requestId: payload.requestId,
        hint: element ? inspectReact(element) : { available: false, componentChain: [], propsKeys: [], boundary: "目标元素已离开页面。" },
      }, "*")
      return
    }
    if (payload.type === "cleanup" && payload.sessionId === state.sessionId) restore(state)
  }
  window.addEventListener("message", onBridgeMessage)
  state.teardown.push(() => window.removeEventListener("message", onBridgeMessage))
  const watchdog = window.setInterval(() => {
    if (!state.sessionId || Date.now() - state.lastHeartbeatAt <= 6_000) return
    document.getElementById("rootline-runtime-overlay")?.remove()
    document.documentElement.style.cursor = ""
    restore(state)
  }, 2_000)
  state.teardown.push(() => window.clearInterval(watchdog))
}

export default defineUnlistedScript(() => install())
