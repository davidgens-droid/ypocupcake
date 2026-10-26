import "client-only"

import { ENVELOPE_RE, MAX_ENVELOPE_CHARS } from "@/lib/updates/envelope"
import { b64urlDecode, b64urlEncode, randomBytes, toBuffer, utf8Decode, utf8Encode } from "./encoding"

/**
 * Encrypted envelopes for updates and pattern cards. Spec §4.
 * AES-256-GCM, 12-byte IV, 128-bit tag, and additional authenticated data
 * binding the ciphertext to its row: moved to another row, it won't open.
 * Envelope: v1.<base64url iv>.<base64url ciphertext||tag>
 */

export const ENVELOPE_VERSION = "v1"

export function updateAad(memberId: string, meetingId: string): string {
  return `cupcake:update:v1:${memberId}:${meetingId}`
}

export function cardAad(memberId: string, cardId: string): string {
  return `cupcake:card:v1:${memberId}:${cardId}`
}

export async function encryptJson(uk: CryptoKey, value: unknown, aad: string): Promise<string> {
  const iv = randomBytes(12)
  const plaintext = utf8Encode(JSON.stringify(value))
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(iv), additionalData: toBuffer(utf8Encode(aad)), tagLength: 128 },
    uk,
    toBuffer(plaintext)
  )
  return `${ENVELOPE_VERSION}.${b64urlEncode(iv)}.${b64urlEncode(ct)}`
}

export class EnvelopeError extends Error {}

export async function decryptJson<T = unknown>(uk: CryptoKey, envelope: string, aad: string): Promise<T> {
  if (!ENVELOPE_RE.test(envelope) || envelope.length > MAX_ENVELOPE_CHARS) {
    throw new EnvelopeError("Not a recognised encrypted update.")
  }
  const [, ivB64, ctB64] = envelope.split(".")
  let pt: ArrayBuffer
  try {
    pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBuffer(b64urlDecode(ivB64)), additionalData: toBuffer(utf8Encode(aad)), tagLength: 128 },
      uk,
      toBuffer(b64urlDecode(ctB64))
    )
  } catch {
    throw new EnvelopeError("This update can't be opened with the current key.")
  }
  return JSON.parse(utf8Decode(new Uint8Array(pt))) as T
}
