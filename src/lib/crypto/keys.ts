import "client-only"

import { randomBytes, toBuffer, utf8Encode } from "./encoding"

/**
 * The member's update key (UK) and the three ways of locking a copy of it.
 * Spec §4. Everything here is WebCrypto; nothing leaves the device unwrapped.
 *
 * - UK: AES-GCM-256. Generated extractable ONLY so it can be wrapped; the
 *   copy the app keeps for day-to-day use is imported non-extractable.
 * - Wrapping: AES-KW (RFC 3394) under a 256-bit key derived per method.
 */

export const PBKDF2_ITERATIONS = 600_000
export const MIN_PASSPHRASE_LENGTH = 12

const HKDF_INFO_PASSKEY = "cupcake:uk-wrap:passkey:v1"
const HKDF_INFO_RECOVERY = "cupcake:uk-wrap:recovery:v1"

export async function generateUpdateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
}

export async function importUpdateKey(raw: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toBuffer(raw), { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"])
}

export async function exportUpdateKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key))
}

async function hkdfToWrappingKey(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", toBuffer(ikm), "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBuffer(salt), info: toBuffer(utf8Encode(info)) },
    base,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  )
}

/** Passkey: the WebAuthn PRF output (32 bytes) → HKDF → AES-KW key. */
export function deriveWrappingKeyFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  return hkdfToWrappingKey(prfOutput, salt, HKDF_INFO_PASSKEY)
}

/** Recovery code: 20 random bytes → HKDF → AES-KW key (high entropy; no slow KDF needed). */
export function deriveWrappingKeyFromRecovery(codeBytes: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  return hkdfToWrappingKey(codeBytes, salt, HKDF_INFO_RECOVERY)
}

/** Passphrase: NFKC-normalised → PBKDF2-HMAC-SHA256 → AES-KW key. */
export async function deriveWrappingKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    toBuffer(utf8Encode(passphrase.normalize("NFKC"))),
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toBuffer(salt), iterations },
    base,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  )
}

export async function wrapUpdateKey(uk: CryptoKey, wrappingKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.wrapKey("raw", uk, wrappingKey, "AES-KW"))
}

/**
 * Unwrap a locked copy. A wrong passphrase / PRF / code fails here with an
 * OperationError (AES-KW is authenticated), never with garbage.
 */
export async function unwrapUpdateKey(
  wrapped: Uint8Array,
  wrappingKey: CryptoKey,
  extractable: boolean
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    toBuffer(wrapped),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"]
  )
}

export function newSalt(bytes = 32): Uint8Array {
  return randomBytes(bytes)
}
