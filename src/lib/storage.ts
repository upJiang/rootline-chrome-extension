import type { RootlineSession, SessionSummary } from "./types"

const SESSION_PREFIX = "rootline:session:"
const TAB_INDEX_KEY = "rootline:tab-index"
export const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000

type TabIndex = Record<string, string>
type SessionMutation = Promise<void>

const sessionMutations = new Map<string, SessionMutation>()
let tabIndexMutation: Promise<void> = Promise.resolve()

function sessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`
}

export function summarizeSession(session: RootlineSession): SessionSummary {
  return {
    id: session.id,
    tabId: session.tabId,
    status: session.status,
    pageTitle: session.page.title,
    pageUrl: session.page.url,
    startedAt: session.startedAt,
    ...(session.captureMode ? { captureMode: session.captureMode } : {}),
    ...(session.saveMode ? { saveMode: session.saveMode } : {}),
    targets: session.targets.length,
    consoleEvents: session.console.length,
    errors: session.console.filter((item) => item.level === "error").length,
    networkEvents: session.network.length,
    ...(session.recordingState ? { recordingState: session.recordingState } : {}),
    ...(session.recording ? { recording: session.recording } : {}),
    ...(session.localArtifacts ? { localArtifacts: session.localArtifacts } : {}),
    ...(session.remoteArtifacts ? { remoteArtifacts: session.remoteArtifacts } : {}),
  }
}

export async function saveSession(session: RootlineSession): Promise<void> {
  await chrome.storage.session.set({ [sessionKey(session.id)]: session })
  tabIndexMutation = tabIndexMutation
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.session.get(TAB_INDEX_KEY)
      const index = (stored[TAB_INDEX_KEY] ?? {}) as TabIndex
      index[String(session.tabId)] = session.id
      await chrome.storage.session.set({ [TAB_INDEX_KEY]: index })
    })
  await tabIndexMutation
}

async function saveSessionWithoutActivating(session: RootlineSession): Promise<void> {
  await chrome.storage.session.set({ [sessionKey(session.id)]: session })
}

export async function readSession(id: string): Promise<RootlineSession | null> {
  const stored = await chrome.storage.session.get(sessionKey(id))
  return (stored[sessionKey(id)] as RootlineSession | undefined) ?? null
}

export async function mutateSession(
  id: string,
  mutation: (session: RootlineSession) => void | Promise<void>,
): Promise<RootlineSession | null> {
  const previous = sessionMutations.get(id) ?? Promise.resolve()
  let result: RootlineSession | null = null
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const session = await readSession(id)
      if (!session) return
      await mutation(session)
      session.updatedAt = new Date().toISOString()
      const stored = await chrome.storage.session.get(TAB_INDEX_KEY)
      const activeId = ((stored[TAB_INDEX_KEY] ?? {}) as TabIndex)[String(session.tabId)]
      if (activeId === session.id) await saveSession(session)
      else await saveSessionWithoutActivating(session)
      result = session
    })
  const settled = operation.then(() => undefined, () => undefined)
  sessionMutations.set(id, settled)
  try {
    await operation
    return result
  } finally {
    if (sessionMutations.get(id) === settled) sessionMutations.delete(id)
  }
}

export async function readSessionForTab(tabId: number): Promise<RootlineSession | null> {
  const stored = await chrome.storage.session.get(TAB_INDEX_KEY)
  const id = ((stored[TAB_INDEX_KEY] ?? {}) as TabIndex)[String(tabId)]
  return id ? readSession(id) : null
}

export async function removeSession(id: string): Promise<void> {
  const session = await readSession(id)
  await chrome.storage.session.remove(sessionKey(id))
  tabIndexMutation = tabIndexMutation
    .catch(() => undefined)
    .then(async () => {
      const stored = await chrome.storage.session.get(TAB_INDEX_KEY)
      const index = (stored[TAB_INDEX_KEY] ?? {}) as TabIndex
      if (session && index[String(session.tabId)] === id) delete index[String(session.tabId)]
      await chrome.storage.session.set({ [TAB_INDEX_KEY]: index })
    })
  await tabIndexMutation
}

export async function cleanExpiredSessions(now = Date.now()): Promise<number> {
  const stored = await chrome.storage.session.get(null)
  const expiredIds = Object.entries(stored)
    .filter(([key, value]) => {
      if (!key.startsWith(SESSION_PREFIX)) return false
      const session = value as RootlineSession
      return now - Date.parse(session.updatedAt) > SESSION_RETENTION_MS
    })
    .map(([, value]) => (value as RootlineSession).id)
  await Promise.all(expiredIds.map(removeSession))
  return expiredIds.length
}
