// Salad Bowl — which players this phone is holding seats for.
//
// No accounts: a seat is {playerId, token, name} kept in this browser's
// localStorage, per game code. One phone can hold several seats (a couple
// sharing a phone, or the host covering for a dead battery).
import type { Seat } from "./types"

interface SeatFile {
  active: string | null
  seats: Seat[]
}

// `?as=<label>` in the URL gives a tab its own seat storage, so several
// "phones" can be open in one browser (demoing / testing).
function ns(): string {
  if (typeof window === "undefined") return "sb"
  const as = new URLSearchParams(window.location.search).get("as")
  return as ? `sb:${as.replace(/[^a-z0-9]/gi, "").slice(0, 12)}` : "sb"
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / storage full: the seat lives for this page view only.
  }
}

const memory = new Map<string, SeatFile>()

export function loadSeats(code: string): SeatFile {
  const key = `${ns()}:seats:${code}`
  if (typeof window === "undefined") return { active: null, seats: [] }
  const file = read<SeatFile | null>(key, null) ?? memory.get(key) ?? { active: null, seats: [] }
  const seats = Array.isArray(file.seats)
    ? file.seats.filter((s) => s && typeof s.playerId === "string" && typeof s.token === "string")
    : []
  const active = seats.some((s) => s.playerId === file.active) ? file.active : (seats[0]?.playerId ?? null)
  return { active, seats }
}

export function saveSeats(code: string, file: SeatFile) {
  const key = `${ns()}:seats:${code}`
  memory.set(key, file)
  write(key, file)
  if (file.seats.length) rememberGame(code)
}

/** Last name typed on this phone, to pre-fill the next game. */
export function lastName(): string {
  if (typeof window === "undefined") return ""
  return read<string>(`${ns()}:name`, "")
}
export function rememberName(name: string) {
  write(`${ns()}:name`, name)
}

/** Games this phone has a seat in, newest first (for "jump back in"). */
export function recentGames(): { code: string; at: number }[] {
  if (typeof window === "undefined") return []
  const cutoff = Date.now() - 36 * 60 * 60 * 1000
  return read<{ code: string; at: number }[]>(`${ns()}:recent`, []).filter(
    (g) => g && typeof g.code === "string" && g.at > cutoff && loadSeats(g.code).seats.length > 0
  )
}
function rememberGame(code: string) {
  const list = read<{ code: string; at: number }[]>(`${ns()}:recent`, []).filter((g) => g.code !== code)
  write(`${ns()}:recent`, [{ code, at: Date.now() }, ...list].slice(0, 5))
}
export function forgetGame(code: string) {
  const list = read<{ code: string; at: number }[]>(`${ns()}:recent`, []).filter((g) => g.code !== code)
  write(`${ns()}:recent`, list)
}

/** Keeps `?as=` when linking between Salad Bowl pages. */
export function withProfile(path: string): string {
  if (typeof window === "undefined") return path
  const as = new URLSearchParams(window.location.search).get("as")
  return as ? `${path}${path.includes("?") ? "&" : "?"}as=${encodeURIComponent(as)}` : path
}

/** "#seat=<playerId>.<token>" — a hand-over link the host made for a player. */
export function parseSeatHash(hash: string): { playerId: string; token: string } | null {
  const m = /seat=([0-9a-f-]{36})\.([0-9a-f-]{36})/i.exec(hash)
  return m ? { playerId: m[1], token: m[2] } : null
}
