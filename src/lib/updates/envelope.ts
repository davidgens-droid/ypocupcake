// The encrypted-envelope FORMAT, shared by the device (which produces it) and
// the server (which only ever validates its shape). No crypto here, so this
// is safe to import anywhere. The crypto itself lives in src/lib/crypto and
// is client-only.

export const ENVELOPE_RE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{24,}$/
/** Generous ceiling (an update is well under 20 KB of JSON). */
export const MAX_ENVELOPE_CHARS = 256 * 1024

export function isEnvelope(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_ENVELOPE_CHARS && ENVELOPE_RE.test(s)
}
