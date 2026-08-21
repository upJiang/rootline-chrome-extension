import type { RootlineReportV1 } from "./types"
import { withoutScreenshotPayload } from "./screenshot-payload"

const DATABASE_NAME = "rootline-capture-history"
const DATABASE_VERSION = 1
const RECORD_STORE = "records"

export interface StoredCaptureRecord {
  directoryName: string
  report: RootlineReportV1
  captureDataUrl?: string
  createdAt: string
  updatedAt: string
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECORD_STORE)) {
        request.result.createObjectStore(RECORD_STORE, { keyPath: "directoryName" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("无法打开 Rootline 采集历史数据库。"))
  })
}

async function requestStore<TResult>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<TResult>,
): Promise<TResult> {
  const database = await openDatabase()
  try {
    return await new Promise<TResult>((resolve, reject) => {
      const transaction = database.transaction(RECORD_STORE, mode)
      const request = operation(transaction.objectStore(RECORD_STORE))
      let result: TResult
      request.onsuccess = () => { result = request.result }
      request.onerror = () => reject(request.error ?? new Error("Rootline 采集历史操作失败。"))
      transaction.onerror = () => reject(transaction.error ?? new Error("Rootline 采集历史事务失败。"))
      transaction.oncomplete = () => resolve(result!)
    })
  } finally {
    database.close()
  }
}

export async function saveStoredCaptureRecord(record: StoredCaptureRecord): Promise<void> {
  await requestStore("readwrite", (store) => store.put({
    ...record,
    report: withoutScreenshotPayload(record.report),
  }))
}

export async function readStoredCaptureRecord(directoryName: string): Promise<StoredCaptureRecord | null> {
  const record = await requestStore<StoredCaptureRecord | undefined>("readonly", (store) => store.get(directoryName))
  return record ?? null
}

export async function listStoredCaptureRecords(): Promise<StoredCaptureRecord[]> {
  return requestStore("readonly", (store) => store.getAll())
}

export async function removeStoredCaptureRecord(directoryName: string): Promise<void> {
  await requestStore("readwrite", (store) => store.delete(directoryName))
}

export async function clearStoredCaptureRecords(): Promise<void> {
  await requestStore("readwrite", (store) => store.clear())
}
