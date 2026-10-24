/**
 * Offline draft queue (IndexedDB). Uploads that fail with a network error are stored locally with their
 * idempotency key and replayed when the device is back online, so a retry can never create duplicates.
 */
import { api, ApiError } from "./api";

export interface QueuedUpload {
  id: string;
  path: string;
  label: string;
  fields: Record<string, string>;
  file: Blob;
  fileName: string;
  createdAt: number;
  lastError?: string;
}

const DB = "tenjicheck-offline";
const STORE = "uploads";
const listeners = new Set<() => void>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((l) => l());

export async function listQueued(): Promise<QueuedUpload[]> {
  try {
    return await tx<QueuedUpload[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedUpload[]>);
  } catch {
    return [];
  }
}

export async function enqueue(item: QueuedUpload) {
  await tx("readwrite", (s) => s.put(item));
  notify();
}

export async function removeQueued(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

function toForm(item: QueuedUpload): FormData {
  const f = new FormData();
  Object.entries(item.fields).forEach(([k, v]) => f.append(k, v));
  f.append("file", item.file, item.fileName);
  return f;
}

/** Try to send now; on network failure store it for later. Returns the server response or null if queued. */
export async function sendOrQueue<T>(item: QueuedUpload): Promise<T | null> {
  try {
    return await api<T>(item.path, { form: toForm(item), headers: { "Idempotency-Key": item.id } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      await enqueue(item);
      return null;
    }
    throw e;
  }
}

export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const item of await listQueued()) {
    try {
      await api(item.path, { form: toForm(item), headers: { "Idempotency-Key": item.id } });
      await removeQueued(item.id);
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof ApiError && e.status !== 0) {
        await enqueue({ ...item, lastError: e.message });
      }
    }
  }
  return { sent, failed };
}
