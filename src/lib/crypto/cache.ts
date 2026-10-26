import "client-only"

/**
 * The unlocked update key, kept on the device between visits. Spec §4.
 * Stored in IndexedDB as a NON-extractable CryptoKey: the app can use it,
 * scripts can't export it. Expires 30 days after unlock; "Lock now" and
 * sign-out delete it. The key's id is stored with it so a key retired by
 * "Start fresh" on another device is recognised and discarded.
 */

const DB_NAME = "cupcake-keys"
const STORE = "keys"
export const UNLOCK_DAYS = 30

export type CachedKey = { key: CryptoKey; keyId: string }
type Record = CachedKey & { lockedAfter: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      })
  )
}

export async function cacheUnlockedKey(memberId: string, key: CryptoKey, keyId: string): Promise<void> {
  if (key.extractable) throw new Error("Only a non-extractable key may be cached.")
  const record: Record = { key, keyId, lockedAfter: Date.now() + UNLOCK_DAYS * 24 * 60 * 60 * 1000 }
  try {
    await tx("readwrite", (s) => s.put(record, memberId))
  } catch {
    // Private windows / blocked storage: the key simply lives in memory for this tab.
  }
}

export async function getCachedKey(memberId: string): Promise<CachedKey | null> {
  try {
    const record = (await tx<Record | undefined>("readonly", (s) => s.get(memberId))) ?? null
    if (!record || !record.keyId) return null
    if (Date.now() > record.lockedAfter) {
      await clearCachedKey(memberId)
      return null
    }
    return { key: record.key, keyId: record.keyId }
  } catch {
    return null
  }
}

export async function clearCachedKey(memberId: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(memberId))
  } catch {
    // nothing to clear
  }
}

export async function clearAllCachedKeys(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.clear())
  } catch {
    // nothing to clear
  }
}
