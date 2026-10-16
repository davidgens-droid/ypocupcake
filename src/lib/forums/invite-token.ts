/** Invite tokens are 64 hex characters (0021); accept a little slack. */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

/** Accepts the full invite link or just the token; returns the token or null. */
export function extractInviteToken(raw: string): string | null {
  const s = raw.trim()
  const afterJoin = s.includes("/join/") ? s.slice(s.indexOf("/join/") + 6) : s
  const token = afterJoin.split(/[?#/\s]/)[0]
  return INVITE_TOKEN_RE.test(token) ? token : null
}
