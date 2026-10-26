"use client"

import { b64urlDecode, b64urlEncode } from "@/lib/crypto/encoding"
import { encryptJson, updateAad } from "@/lib/crypto/content"
import {
  deriveWrappingKeyFromPassphrase,
  deriveWrappingKeyFromPrf,
  deriveWrappingKeyFromRecovery,
  exportUpdateKey,
  importUpdateKey,
  newSalt,
  PBKDF2_ITERATIONS,
  unwrapUpdateKey,
  wrapUpdateKey,
} from "@/lib/crypto/keys"
import { assertPasskeyPrf, registerPasskeyWithPrf } from "@/lib/crypto/passkey"
import { generateRecoveryCode, parseRecoveryCode } from "@/lib/crypto/recovery"
import { cacheUnlockedKey } from "@/lib/crypto/cache"
import { setUnlockedKey } from "@/lib/crypto/session"
import type { KeyWrap, WrapInput } from "@/lib/security/actions"
import { getMyLegacyUpdates, migrateUpdates } from "@/lib/updates/actions"
import { parseStoredUpdate } from "@/lib/updates/schema"

/**
 * The device-side half of unlocking and of making locked copies. Spec §4.
 * `extractable` is true only for the moment a new copy must be wrapped
 * (setup, adding a device, changing a passphrase or recovery code).
 */

export class UnlockError extends Error {}

export type Unlocked = { key: CryptoKey; keyId: string; wrapId: string }

export async function unlockWithPasskey(wraps: KeyWrap[], extractable = false): Promise<Unlocked> {
  const passkeys = wraps.filter((w) => w.kind === "passkey" && w.credential_id && w.prf_salt)
  const assertion = await assertPasskeyPrf(
    passkeys.map((w) => ({ credentialId: w.credential_id!, prfSalt: w.prf_salt!, transports: w.transports }))
  )
  if (!assertion) throw new UnlockError("Your device didn't complete the passkey check.")
  const wrap = passkeys.find((w) => w.credential_id === assertion.credentialId)
  if (!wrap) throw new UnlockError("That passkey isn't registered for your updates.")
  const wk = await deriveWrappingKeyFromPrf(assertion.prfOutput, b64urlDecode(wrap.prf_salt!))
  assertion.prfOutput.fill(0)
  try {
    return { key: await unwrapUpdateKey(b64urlDecode(wrap.wrapped_key), wk, extractable), keyId: wrap.key_id, wrapId: wrap.id }
  } catch {
    throw new UnlockError("That passkey couldn't unlock your updates.")
  }
}

export async function unlockWithPassphrase(wraps: KeyWrap[], passphrase: string, extractable = false): Promise<Unlocked> {
  const wrap = wraps.find((w) => w.kind === "passphrase")
  if (!wrap || !wrap.kdf_salt) throw new UnlockError("No passphrase is set on this account.")
  const wk = await deriveWrappingKeyFromPassphrase(passphrase, b64urlDecode(wrap.kdf_salt), wrap.kdf_iterations ?? PBKDF2_ITERATIONS)
  try {
    return { key: await unwrapUpdateKey(b64urlDecode(wrap.wrapped_key), wk, extractable), keyId: wrap.key_id, wrapId: wrap.id }
  } catch {
    throw new UnlockError("That passphrase isn't right.")
  }
}

export async function unlockWithRecovery(wraps: KeyWrap[], code: string, extractable = false): Promise<Unlocked> {
  const wrap = wraps.find((w) => w.kind === "recovery")
  if (!wrap || !wrap.kdf_salt) throw new UnlockError("No recovery code is set on this account.")
  const bytes = parseRecoveryCode(code)
  if (!bytes) throw new UnlockError("That doesn't look like a recovery code (32 letters and digits).")
  const wk = await deriveWrappingKeyFromRecovery(bytes, b64urlDecode(wrap.kdf_salt))
  bytes.fill(0)
  try {
    return { key: await unwrapUpdateKey(b64urlDecode(wrap.wrapped_key), wk, extractable), keyId: wrap.key_id, wrapId: wrap.id }
  } catch {
    throw new UnlockError("That recovery code isn't right.")
  }
}

/** Keep an unlocked key for this device: non-extractable copy in the cache + the tab's store. */
export async function adoptUnlockedKey(memberId: string, key: CryptoKey, keyId: string): Promise<CryptoKey> {
  const usable = key.extractable ? await importUpdateKey(await exportUpdateKey(key), false) : key
  await cacheUnlockedKey(memberId, usable, keyId)
  setUnlockedKey(memberId, usable, keyId)
  return usable
}

export type SweepResult = {
  total: number
  remaining: number
  /** Why the first failure happened, in words fit for a toast; null when all went through. */
  reason: string | null
}

/**
 * Encrypt any of the member's updates that are still stored readable (rows
 * never migrated, or a migration that was interrupted). Idempotent: the
 * server only touches rows without an envelope, so this is safe to run
 * after every unlock. Older or partial rows are normalised into today's
 * shape without dropping text; only something that isn't an update at all
 * is left alone. Returns how many remain unprotected and why.
 */
export async function sweepLegacyUpdates(
  memberId: string,
  key: CryptoKey,
  keyId: string,
  onProgress?: (done: number, total: number) => void
): Promise<SweepResult> {
  const legacy = await getMyLegacyUpdates()
  if (legacy.length === 0) return { total: 0, remaining: 0, reason: null }
  let remaining = legacy.length
  let reason: string | null = null
  for (let i = 0; i < legacy.length; i += 10) {
    const rows = []
    let unreadable = 0
    for (const row of legacy.slice(i, i + 10)) {
      const parsed = parseStoredUpdate(row.content)
      if (!parsed) {
        unreadable++
        continue
      }
      rows.push({
        meetingId: row.meetingId,
        contentEnc: await encryptJson(key, parsed, updateAad(memberId, row.meetingId)),
        qol: parsed.qol,
        keyId,
      })
    }
    if (unreadable > 0) reason ??= `${unreadable} of them ${unreadable === 1 ? "isn't" : "aren't"} readable as an update.`
    if (rows.length > 0) {
      const res = await migrateUpdates(rows)
      if (res.ok) remaining -= rows.length
      else reason ??= res.error
    }
    onProgress?.(Math.min(i + 10, legacy.length), legacy.length)
  }
  return { total: legacy.length, remaining, reason }
}

// ── making locked copies ─────────────────────────────────────────────────────

export async function makePasskeyWrap(
  uk: CryptoKey,
  member: { id: string; email: string; name: string },
  existing: KeyWrap[] = []
): Promise<WrapInput | null> {
  const reg = await registerPasskeyWithPrf({
    memberId: member.id,
    email: member.email,
    name: member.name,
    excludeCredentialIds: existing.filter((w) => w.kind === "passkey" && w.credential_id).map((w) => w.credential_id!),
  })
  if (!reg) return null
  const wk = await deriveWrappingKeyFromPrf(reg.prfOutput, b64urlDecode(reg.prfSalt))
  reg.prfOutput.fill(0)
  return {
    kind: "passkey",
    credential_id: reg.credentialId,
    public_key: reg.publicKey,
    transports: reg.transports,
    prf_salt: reg.prfSalt,
    wrapped_key: b64urlEncode(await wrapUpdateKey(uk, wk)),
    label: reg.label,
  }
}

export async function makePassphraseWrap(uk: CryptoKey, passphrase: string): Promise<WrapInput> {
  const salt = newSalt(16)
  const wk = await deriveWrappingKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS)
  return {
    kind: "passphrase",
    kdf_salt: b64urlEncode(salt),
    kdf_iterations: PBKDF2_ITERATIONS,
    wrapped_key: b64urlEncode(await wrapUpdateKey(uk, wk)),
  }
}

export async function makeRecoveryWrap(uk: CryptoKey): Promise<{ wrap: WrapInput; display: string }> {
  const code = generateRecoveryCode()
  const salt = newSalt(32)
  const wk = await deriveWrappingKeyFromRecovery(code.bytes, salt)
  const wrap: WrapInput = {
    kind: "recovery",
    kdf_salt: b64urlEncode(salt),
    wrapped_key: b64urlEncode(await wrapUpdateKey(uk, wk)),
  }
  code.bytes.fill(0)
  return { wrap, display: code.display }
}
