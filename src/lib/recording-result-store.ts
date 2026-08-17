export interface StoredRecordingFrame {
  id: string
  capturedAt: number
  offsetMs: number
  dataUrl: string
  reason: "start" | "page-change" | "marker" | "stop"
  label?: string
}

export interface StoredRecordingResult {
  id: string
  blob: Blob
  createdAt: number
  durationMs: number
  frameQueue: StoredRecordingFrame[]
  mimeType: string
  startedAt: number
}

const DB_NAME = "rootline-recording-results"
const DB_VERSION = 1
const STORE_NAME = "recordings"

export async function saveRecordingResult(result: StoredRecordingResult): Promise<void> {
  const db = await openRecordingDatabase()
  await runStoreRequest(db, "readwrite", (store) => store.put(result))
  db.close()
}

export async function readRecordingResult(id: string): Promise<StoredRecordingResult | null> {
  const db = await openRecordingDatabase()
  const result = await runStoreRequest<StoredRecordingResult | undefined>(db, "readonly", (store) => store.get(id))
  db.close()
  return result ?? null
}

export async function deleteRecordingResult(id: string): Promise<void> {
  const db = await openRecordingDatabase()
  await runStoreRequest(db, "readwrite", (store) => store.delete(id))
  db.close()
}

function openRecordingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" })
    }
    request.onerror = () => reject(request.error ?? new Error("录制临时数据库打开失败。"))
    request.onsuccess = () => resolve(request.result)
  })
}

function runStoreRequest<TResult>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<TResult>,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = createRequest(transaction.objectStore(STORE_NAME))
    let result: TResult
    request.onerror = () => reject(request.error ?? new Error("录制临时数据读写失败。"))
    request.onsuccess = () => { result = request.result }
    transaction.onerror = () => reject(transaction.error ?? new Error("录制临时数据事务失败。"))
    transaction.oncomplete = () => resolve(result!)
  })
}
