import "client-only"

import { b64urlDecode, b64urlEncode, randomBytes, toBuffer, utf8Encode } from "./encoding"

/**
 * Passkeys as a key-derivation device (WebAuthn PRF extension). Spec §4.
 * The server never verifies an assertion: the passkey's only job here is to
 * hand the device a secret that unlocks the member's update key. The public
 * key is kept so the same passkey can become a sign-in factor later.
 */

export type RegisteredPasskey = {
  credentialId: string // base64url
  publicKey: string | null // base64url SPKI DER
  transports: string[]
  prfSalt: string // base64url, 32 bytes
  prfOutput: Uint8Array // 32 bytes — use immediately, never store
  label: string
}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } }

export function passkeyApiAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined"
}

/** A platform authenticator (Face ID, Touch ID, Windows Hello, Android screen lock) on this device. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeyApiAvailable()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** "Face ID", "Touch ID", "Windows Hello"… for button labels; best effort. */
export function biometricLabel(): string {
  if (typeof navigator === "undefined") return "device passkey"
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return "Face ID / Touch ID"
  if (/Macintosh/.test(ua)) return "Touch ID"
  if (/Windows/.test(ua)) return "Windows Hello"
  if (/Android/.test(ua)) return "fingerprint / screen lock"
  return "device passkey"
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Device"
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : "Device"
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : ""
  return browser ? `${os} · ${browser}` : os
}

function prfOf(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults }
  const first = ext.prf?.results?.first
  if (!first) return null
  return first instanceof Uint8Array ? first : new Uint8Array(first)
}

/**
 * A plain-English reason for a failed passkey step, from the DOMException
 * the browser raised. Shown to the member; no browser jargon.
 */
export function describePasskeyError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : ""
  switch (name) {
    case "NotAllowedError":
      return "No passkey was made: the request was cancelled, timed out, or this browser has no Face ID / Touch ID / Windows Hello to offer. If you're inside another app's browser, open www.ypocupcake.com in Chrome, Edge or Safari directly."
    case "NotSupportedError":
    case "NotReadableError":
      return "This browser can't create a passkey for this device. Open www.ypocupcake.com in Chrome, Edge or Safari, or use a passphrase here."
    case "InvalidStateError":
      return "This device already holds a passkey for your account. Unlock with it instead, or remove it under Devices first."
    case "SecurityError":
      return "Passkeys only work on the real site address. Open www.ypocupcake.com directly."
    case "AbortError":
      return "The passkey step was interrupted. Try again."
    default:
      return "The passkey step didn't complete. Try again, or use a passphrase on this device."
  }
}

/**
 * Register a passkey on THIS device (its own Face ID / Touch ID / Windows
 * Hello / screen lock — never a USB security key or another phone, which
 * is what browsers offer when the attachment is left open) and evaluate
 * PRF with a fresh salt. Returns null when the authenticator doesn't
 * support PRF (the caller then offers the passphrase path). Registration
 * is create → immediate get, because some authenticators only evaluate
 * PRF during an assertion. Browser errors (cancelled, unsupported…)
 * propagate; see describePasskeyError().
 */
export async function registerPasskeyWithPrf(opts: {
  memberId: string
  email: string
  name: string
  /** Credentials the member already has, so the same authenticator isn't enrolled twice. */
  excludeCredentialIds?: string[]
}): Promise<RegisteredPasskey | null> {
  if (!passkeyApiAvailable()) return null
  const rpId = window.location.hostname
  const salt = randomBytes(32)

  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Cupcake", id: rpId },
      user: { id: toBuffer(utf8Encode(opts.memberId)), name: opts.email, displayName: opts.name },
      challenge: toBuffer(randomBytes(32)),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      excludeCredentials: (opts.excludeCredentialIds ?? []).map((id) => ({ type: "public-key" as const, id: toBuffer(b64urlDecode(id)) })),
      timeout: 120_000,
      extensions: { prf: { eval: { first: toBuffer(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!created) return null

  const attestation = created.response as AuthenticatorAttestationResponse
  const publicKeyDer = typeof attestation.getPublicKey === "function" ? attestation.getPublicKey() : null
  const transports = typeof attestation.getTransports === "function" ? attestation.getTransports() : []
  const credentialId = b64urlEncode(new Uint8Array(created.rawId))

  // The browser says outright when this authenticator can't do PRF: stop
  // here rather than prompting again for nothing.
  const prfExt = (created.getClientExtensionResults() as { prf?: PrfResults }).prf
  if (prfExt && prfExt.enabled === false) return null

  // PRF from create, or from an immediate get with the same salt.
  let prfOutput = prfOf(created)
  if (!prfOutput) {
    const got = (await navigator.credentials.get({
      publicKey: {
        rpId,
        challenge: toBuffer(randomBytes(32)),
        allowCredentials: [{ type: "public-key", id: toBuffer(new Uint8Array(created.rawId)), transports: transports as AuthenticatorTransport[] }],
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: toBuffer(salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null
    prfOutput = got ? prfOf(got) : null
  }
  if (!prfOutput) return null

  return {
    credentialId,
    publicKey: publicKeyDer ? b64urlEncode(new Uint8Array(publicKeyDer)) : null,
    transports,
    prfSalt: b64urlEncode(salt),
    prfOutput,
    label: deviceLabel(),
  }
}

/**
 * Unlock with any of the member's registered passkeys: one assertion with
 * every credential allowed, PRF evaluated with each credential's own salt.
 */
export async function assertPasskeyPrf(
  wraps: { credentialId: string; prfSalt: string; transports?: string[] | null }[]
): Promise<{ credentialId: string; prfOutput: Uint8Array } | null> {
  if (!passkeyApiAvailable() || wraps.length === 0) return null
  const rpId = window.location.hostname
  const evalByCredential: Record<string, { first: ArrayBuffer }> = {}
  for (const w of wraps) evalByCredential[w.credentialId] = { first: toBuffer(b64urlDecode(w.prfSalt)) }

  const got = (await navigator.credentials.get({
    publicKey: {
      rpId,
      challenge: toBuffer(randomBytes(32)),
      allowCredentials: wraps.map((w) => ({
        type: "public-key" as const,
        id: toBuffer(b64urlDecode(w.credentialId)),
        transports: (w.transports ?? []) as AuthenticatorTransport[],
      })),
      userVerification: "required",
      timeout: 120_000,
      extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!got) return null
  const prfOutput = prfOf(got)
  if (!prfOutput) return null
  return { credentialId: b64urlEncode(new Uint8Array(got.rawId)), prfOutput }
}
