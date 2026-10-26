import "client-only"

import { randomBytes } from "./encoding"

/**
 * Recovery codes: 20 random bytes shown as 32 Crockford-base32 characters in
 * eight groups of four (e.g. "7K3M-Q2ZD-…"). Crockford's alphabet avoids
 * I/L/O/U so a code read over the phone or typed from paper survives.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const RECOVERY_BYTES = 20
const CHARS = (RECOVERY_BYTES * 8) / 5 // 32

export function generateRecoveryCode(): { bytes: Uint8Array; display: string } {
  const bytes = randomBytes(RECOVERY_BYTES)
  return { bytes, display: formatRecoveryCode(encodeBase32(bytes)) }
}

export function formatRecoveryCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join("-") ?? raw
}

/** Tolerant parse: case-insensitive, ignores spaces/dashes, maps I/L→1 and O→0. */
export function parseRecoveryCode(input: string): Uint8Array | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
  if (cleaned.length !== CHARS) return null
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null
  return decodeBase32(cleaned)
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function decodeBase32(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 5) / 8))
  let bits = 0
  let value = 0
  let i = 0
  for (const ch of s) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}
