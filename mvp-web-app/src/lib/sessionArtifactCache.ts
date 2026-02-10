/**
 * Session artifact cache - queue session summaries for sequential flush.
 * Avoids spamming the backend when the user repeatedly runs/submits; artifacts
 * are stored in memory (and IndexedDB for durability) and flushed at the next
 * interval when the health check is passing.
 */

import type { SessionArtifact } from "./sessionSummary";

const LOG_PREFIX = "[SessionArtifactCache]";

function shouldLogSessionDebug(): boolean {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") return true;
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SESSION_DEBUG === "1") return true;
  if (typeof window !== "undefined") {
    if ((window as unknown as { __SESSION_DEBUG?: boolean }).__SESSION_DEBUG === true) return true;
    try {
      if (localStorage.getItem("SESSION_DEBUG") === "1") return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function cacheLog(msg: string, data?: Record<string, unknown>): void {
  if (!shouldLogSessionDebug() && !msg.includes("fail")) return;
  if (data != null) console.log(`${LOG_PREFIX} ${msg}`, data);
  else console.log(`${LOG_PREFIX} ${msg}`);
}

const DB_NAME = "session-artifacts-cache";
const DB_VERSION = 1;
const STORE_NAME = "pending";

const memoryQueue: SessionArtifact[] = [];
let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "summary.sessionId" });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Enqueue a session artifact to be flushed later. Appends to in-memory queue
 * and persists to IndexedDB so we don't lose on tab close.
 */
export async function enqueueSessionArtifact(artifact: SessionArtifact): Promise<void> {
  const sessionId = artifact.summary.sessionId;
  memoryQueue.push(artifact);
  cacheLog("enqueue (memory)", {
    sessionId,
    memoryQueueLength: memoryQueue.length,
    source: "endAttemptSession after artifact marshaled",
  });
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(artifact);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    cacheLog("enqueue (IndexedDB persisted)", {
      sessionId,
      store: STORE_NAME,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} IndexedDB enqueue failed:`, err);
    cacheLog("enqueue IndexedDB failed", { sessionId, err });
  }
}

/**
 * Drain all pending artifacts (memory + IndexedDB) in order. Clears both.
 * Caller should upload each sequentially.
 */
export async function drainSessionArtifacts(): Promise<SessionArtifact[]> {
  let fromIdb: SessionArtifact[] = [];
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    fromIdb = await new Promise<SessionArtifact[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []) as SessionArtifact[]);
      req.onerror = () => reject(req.error);
    });
    cacheLog("drain read IndexedDB", {
      fromIdbCount: fromIdb.length,
      sessionIds: fromIdb.map((a) => a.summary.sessionId),
    });
    await new Promise<void>((resolve, reject) => {
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} IndexedDB drain failed:`, err);
    cacheLog("drain IndexedDB failed", { err });
  }
  // Dedupe by sessionId: same artifact can be in both IDB and memory; keep one per session
  const memoryCount = memoryQueue.length;
  const bySessionId = new Map<string, SessionArtifact>();
  for (const a of fromIdb) bySessionId.set(a.summary.sessionId, a);
  for (const a of memoryQueue) bySessionId.set(a.summary.sessionId, a);
  memoryQueue.length = 0;
  const combined = Array.from(bySessionId.values());
  cacheLog("drain combined", {
    fromIdbCount: fromIdb.length,
    memoryCount,
    total: combined.length,
    sessionIds: combined.map((a) => a.summary.sessionId),
    source: "flushSessionArtifacts scheduler or forceFlush",
  });
  return combined;
}

/**
 * Pending count (memory only; used for quick checks).
 */
export function getSessionArtifactQueueLength(): number {
  return memoryQueue.length;
}

/**
 * Re-enqueue a single artifact (e.g. after upload failure) for next flush.
 */
export async function reEnqueueSessionArtifact(artifact: SessionArtifact): Promise<void> {
  const sessionId = artifact.summary.sessionId;
  memoryQueue.push(artifact);
  cacheLog("reEnqueue", {
    sessionId,
    memoryQueueLength: memoryQueue.length,
    source: "upload failed in flushSessionArtifacts",
  });
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add(artifact);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    cacheLog("reEnqueue (IndexedDB persisted)", { sessionId });
  } catch (err) {
    console.warn(`${LOG_PREFIX} IndexedDB re-enqueue failed:`, err);
    cacheLog("reEnqueue IndexedDB failed", { sessionId, err });
  }
}
