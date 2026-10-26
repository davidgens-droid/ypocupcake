import "client-only"

import { clearCachedKey, getCachedKey } from "./cache"

/**
 * One in-memory holder for the unlocked update key, shared by every
 * component in the tab (builder, history, pattern cards…), exposed through
 * useSyncExternalStore. Backed by the IndexedDB cache across visits.
 */

export type KeySnapshot = { memberId: string | null; key: CryptoKey | null; keyId: string | null; checked: boolean }

const EMPTY: KeySnapshot = { memberId: null, key: null, keyId: null, checked: false }
let snapshot: KeySnapshot = EMPTY
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeKey(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getKeySnapshot(): KeySnapshot {
  return snapshot
}

export function setUnlockedKey(memberId: string, key: CryptoKey | null, keyId: string | null) {
  snapshot = { memberId, key, keyId, checked: true }
  emit()
}

/** Load the cached key for this member once per tab (no-op if already checked for them). */
export async function restoreKey(memberId: string): Promise<{ key: CryptoKey; keyId: string } | null> {
  if (snapshot.checked && snapshot.memberId === memberId) {
    return snapshot.key && snapshot.keyId ? { key: snapshot.key, keyId: snapshot.keyId } : null
  }
  const cached = await getCachedKey(memberId)
  snapshot = { memberId, key: cached?.key ?? null, keyId: cached?.keyId ?? null, checked: true }
  emit()
  return cached
}

export async function lockKey(memberId: string) {
  await clearCachedKey(memberId)
  snapshot = { memberId, key: null, keyId: null, checked: true }
  emit()
}

/** Forget everything in this tab (sign-out). The IndexedDB cache is cleared separately. */
export function forgetAllKeys() {
  snapshot = EMPTY
  emit()
}
