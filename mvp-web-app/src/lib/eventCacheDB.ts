/**
 * eventCacheDB - Lightweight IndexedDB wrapper for persisting action events
 * 
 * Used as a fallback when:
 * - navigator.onLine === false
 * - Flush fails after max retries
 * - Page unload with pending events
 * 
 * On next initialization, pending events are recovered and merged into buffer.
 */

const DB_NAME = "action-events-cache";
const DB_VERSION = 1;
const STORE_NAME = "pending-events";
const COMPRESSED_STORE = "compressed-bundles";

let dbInstance: IDBDatabase | null = null;

/**
 * Open or create the IndexedDB database
 */
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

      // Store for pending raw events (keyed by auto-increment)
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { autoIncrement: true });
      }

      // Store for compressed bundles
      if (!db.objectStoreNames.contains(COMPRESSED_STORE)) {
        db.createObjectStore(COMPRESSED_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Store pending events to IndexedDB for later recovery
 */
export async function cacheEvents(events: unknown[]): Promise<void> {
  if (events.length === 0) return;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const event of events) {
      store.add(event);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[EventCacheDB] Failed to cache events:", err);
  }
}

/**
 * Retrieve and clear all pending events from IndexedDB
 * Returns events in insertion order
 */
export async function drainCachedEvents(): Promise<unknown[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        const events = getRequest.result || [];
        // Clear after reading
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => resolve(events);
        clearRequest.onerror = () => {
          // Return events even if clear fails
          resolve(events);
        };
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (err) {
    console.warn("[EventCacheDB] Failed to drain cached events:", err);
    return [];
  }
}

/**
 * Store a compressed bundle to IndexedDB
 */
export async function cacheCompressedBundle(bundle: unknown): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(COMPRESSED_STORE, "readwrite");
    const store = tx.objectStore(COMPRESSED_STORE);
    store.add(bundle);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[EventCacheDB] Failed to cache compressed bundle:", err);
  }
}

/**
 * Retrieve and clear all compressed bundles from IndexedDB
 */
export async function drainCompressedBundles(): Promise<unknown[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(COMPRESSED_STORE, "readwrite");
    const store = tx.objectStore(COMPRESSED_STORE);

    return new Promise((resolve, reject) => {
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        const bundles = getRequest.result || [];
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => resolve(bundles);
        clearRequest.onerror = () => resolve(bundles);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (err) {
    console.warn("[EventCacheDB] Failed to drain compressed bundles:", err);
    return [];
  }
}

/**
 * Get count of pending events (without reading them)
 */
export async function getCachedEventCount(): Promise<number> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const countRequest = store.count();
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Close the database connection (for cleanup)
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
