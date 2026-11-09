"use client"

// Salad Bowl — one live game on this phone.
//
// GameStore keeps the latest game state in sync (Realtime ping → refetch,
// with polling as a safety net), holds this phone's seats, plays the
// "you're up" alerts, and exposes every action a screen can take.
// Screens read it through useGame(); they never talk to the API directly.
import { useEffect, useState, useSyncExternalStore } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"

import { api, sb, type HostAction, type TurnAction } from "./api"
import { forgetGame, loadSeats, parseSeatHash, rememberName, saveSeats } from "./seats"
import { buzz, keepAwake, sfx } from "./sound"
import type { GameState, Result, Seat, Settings } from "./types"

export interface Snapshot {
  /** loading → first fetch in flight; missing → no game with this code;
   *  not_installed → the database step hasn't been run; ready → state is set. */
  phase: "loading" | "ready" | "missing" | "not_installed"
  state: GameState | null
  /** Every seat this phone holds in this game. */
  seats: Seat[]
  /** The seat currently being played on this phone (null → not joined). */
  seat: Seat | null
  /** This phone had a seat but the host removed or moved it. */
  seatLost: boolean
  /** Last request reached the server. False → show a "reconnecting" hint. */
  online: boolean
  /** serverTime − phoneTime in ms. Use useCountdown() rather than this. */
  offset: number
  /** Name of the action in flight ("turn:correct", "host:start", …) or null. */
  pending: string | null
}

const SERVER_SNAPSHOT: Snapshot = {
  phase: "loading",
  state: null,
  seats: [],
  seat: null,
  seatLost: false,
  online: true,
  offset: 0,
  pending: null,
}

export class GameStore {
  readonly code: string
  /** TV / big-screen mode: no seat, sees only what a bystander may see. */
  readonly spectator: boolean

  private snap: Snapshot
  private listeners = new Set<() => void>()
  private users = 0
  private channel: RealtimeChannel | null = null
  private realtime = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private lastFetch = 0
  private lastRollCall = 0
  private inflight: Promise<void> | null = null
  private again = false
  private homed = false
  /** The ready screen this phone last handed over for (done once per screen). */
  private handedFor = ""
  private onVisible = () => {
    if (document.visibilityState === "visible") void this.refresh()
  }
  // A seat link pasted into a tab that already has the game open only changes
  // the #fragment, so the page does not reload: pick the seat up here.
  private onHash = () => {
    if (this.spectator || !parseSeatHash(window.location.hash)) return
    this.importSeatFromHash()
    void this.refresh()
  }

  constructor(code: string, spectator = false) {
    this.code = code.toUpperCase()
    this.spectator = spectator
    const file = spectator ? { active: null, seats: [] as Seat[] } : loadSeats(this.code)
    this.snap = {
      ...SERVER_SNAPSHOT,
      seats: file.seats,
      seat: file.seats.find((s) => s.playerId === file.active) ?? null,
    }
  }

  // ── subscription plumbing ─────────────────────────────────────────────────
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.snap
  getServerSnapshot = () => SERVER_SNAPSHOT

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  mount() {
    this.users++
    if (this.users > 1) return
    if (!this.spectator) this.importSeatFromHash()
    void this.refresh()
    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      const idle = Date.now() - this.lastFetch
      const turnLive = this.snap.state?.turn?.state === "active"
      // Realtime tells us about changes; polling is the fallback and the
      // heartbeat that shows this phone as "here".
      const limit = this.realtime ? 6000 : turnLive ? 1200 : 2500
      if (idle > limit) void this.refresh()
    }, 500)
    document.addEventListener("visibilitychange", this.onVisible)
    window.addEventListener("hashchange", this.onHash)
  }

  unmount() {
    this.users = Math.max(0, this.users - 1)
    if (this.users > 0) return
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.pollTimer = null
    this.expiryTimer = null
    document.removeEventListener("visibilitychange", this.onVisible)
    window.removeEventListener("hashchange", this.onHash)
    if (this.channel) void sb().removeChannel(this.channel)
    this.channel = null
    this.realtime = false
    keepAwake(false)
  }

  // ── syncing ───────────────────────────────────────────────────────────────
  refresh(): Promise<void> {
    if (this.inflight) {
      this.again = true
      return this.inflight
    }
    this.inflight = this.fetchOnce().finally(() => {
      this.inflight = null
      if (this.again) {
        this.again = false
        void this.refresh()
      }
    })
    return this.inflight
  }

  private async fetchOnce() {
    const seat = this.snap.seat
    const sent = Date.now()
    const res = await api.state(this.code, seat?.token ?? null)
    this.lastFetch = Date.now()
    if (!res.ok) {
      if (res.error === "no_game") this.set({ phase: "missing", state: null })
      else if (res.error === "not_installed") this.set({ phase: "not_installed" })
      else this.set({ online: false })
      return
    }
    if ((this.snap.seat?.playerId ?? null) !== (seat?.playerId ?? null)) {
      // The phone switched players while this was in the air: ask again as the current one.
      void this.refresh()
      return
    }
    if (seat && !res.seat) {
      // The seat we presented is gone (removed, or handed to another phone).
      this.dropSeat(seat.playerId, true)
      if (this.snap.seat) {
        void this.refresh()
        return
      }
    }
    // Other players sharing this phone are here too: check them in now and
    // then, or every other phone shows them as asleep.
    if (this.snap.seats.length > 1 && this.lastFetch - this.lastRollCall > 10000) {
      this.lastRollCall = this.lastFetch
      for (const other of this.snap.seats) {
        if (other.playerId !== seat?.playerId) void api.state(this.code, other.token)
      }
    }
    this.apply(res.state, this.lastFetch - sent)
  }

  private apply(next: GameState, rtt = 0) {
    const prev = this.snap.state
    const seat = this.snap.seat
    // Out-of-order reply: keep the newer picture (unless the viewer changed).
    if (prev && next.v < prev.v && (prev.me?.id ?? null) === (next.me?.id ?? null)) return

    const offset = next.now + Math.min(rtt, 2000) / 2 - Date.now()
    this.set({ phase: "ready", state: next, online: true, offset, seatLost: seat ? false : this.snap.seatLost })

    this.connectRealtime(next.id)
    this.scheduleExpiry(next, offset)
    // Lobby too: a phone that auto-locks while its owner waits never sees the show start.
    keepAwake(next.status !== "finished")
    if (prev) this.alerts(prev, next)

    // Several players on one phone: when one of them is up, hand them the
    // screen; once the mic moves on (or the game ends), go back to the
    // phone's own player, so a host covering for someone gets their host
    // controls back without touching anything.
    const turn = next.turn
    const home = this.snap.seats[0]
    if (seat && home && this.snap.seats.length > 1) {
      if (next.status === "playing" && turn && turn.state === "ready") {
        // Once per ready screen, so a name tapped in the menu afterwards sticks.
        const key = `${turn.playerId}:${turn.since}`
        if (key !== this.handedFor) {
          this.handedFor = key
          const up = this.snap.seats.find((s) => s.playerId === turn.playerId)
          const target = up ?? home
          if (target.playerId !== seat.playerId) this.switchSeat(target.playerId)
        }
      } else if (
        next.status === "playing" &&
        turn &&
        turn.state === "active" &&
        prev?.turn?.state === "paused" &&
        turn.playerId !== seat.playerId
      ) {
        // Clock resumed: a clue-giver held on this phone gets the word back.
        const up = this.snap.seats.find((s) => s.playerId === turn.playerId)
        if (up) this.switchSeat(up.playerId)
      } else if (next.status === "finished" && !this.homed && seat.playerId !== home.playerId) {
        // Once per finale (so the menu can still switch seats afterwards).
        this.switchSeat(home.playerId)
      }
    }
    this.homed = next.status === "finished"
  }

  private connectRealtime(gameId: string) {
    if (this.channel || this.users === 0) return
    this.channel = sb()
      .channel(`saladbowl:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "saladbowl_pulse", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const v = Number((payload.new as { v?: number } | null)?.v ?? 0)
          if (!this.snap.state || !v || v > this.snap.state.v) void this.refresh()
        }
      )
      .subscribe((status) => {
        this.realtime = status === "SUBSCRIBED"
        if (this.realtime) void this.refresh()
      })
  }

  /** When the clock hits zero (plus the server's grace), go and fetch the result. */
  private scheduleExpiry(state: GameState, offset: number) {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = null
    const turn = state.turn
    if (state.status !== "playing" || !turn || turn.state !== "active" || !turn.endsAt) return
    const wait = turn.endsAt - (Date.now() + offset) + 1350
    this.expiryTimer = setTimeout(() => void this.refresh(), Math.max(200, wait))
  }

  private alerts(prev: GameState, next: GameState) {
    const mine = (id: string | undefined | null) => !!id && this.snap.seats.some((s) => s.playerId === id)
    const p = prev.turn
    const n = next.turn
    if (prev.status !== "finished" && next.status === "finished") {
      sfx.finale()
      buzz([120, 80, 120, 80, 500])
      return
    }
    if (prev.status === "lobby" && next.status === "lobby" && next.players.length > prev.players.length) {
      sfx.join()
    }
    if (!n || next.status !== "playing") return
    const becameReady =
      n.state === "ready" && (!p || p.state !== "ready" || p.playerId !== n.playerId || prev.status !== "playing")
    if (becameReady) {
      if (mine(n.playerId)) {
        sfx.yourTurn()
        buzz([220, 90, 220, 90, 500])
      } else if (mine(next.onDeck?.playerId)) {
        sfx.onDeck()
        buzz(90)
      }
    }
    if (p && p.state === "active" && n.state === "active" && p.no === n.no) {
      if (n.got > p.got) sfx.ding()
      else if (n.skips > p.skips) sfx.skip()
    }
    if (p && p.no === n.no && (p.state === "active" || p.state === "paused") && n.state === "review") {
      if (n.reason === "bowl") sfx.fanfare()
      else sfx.buzzer()
      buzz(600)
    }
  }

  // ── seats ─────────────────────────────────────────────────────────────────
  private persistSeats(seats: Seat[], active: string | null) {
    saveSeats(this.code, { active, seats })
    this.set({ seats, seat: seats.find((s) => s.playerId === active) ?? null })
  }

  private addSeat(seat: Seat) {
    const seats = [...this.snap.seats.filter((s) => s.playerId !== seat.playerId), seat]
    this.persistSeats(seats, seat.playerId)
    this.set({ seatLost: false })
  }

  /** Play as another seat held on this phone. */
  switchSeat(playerId: string) {
    if (!this.snap.seats.some((s) => s.playerId === playerId)) return
    this.persistSeats(this.snap.seats, playerId)
    void this.refresh()
  }

  /** "Leave game" on this phone: forget its seats (the players stay in the game). */
  forgetSeats() {
    this.persistSeats([], null)
    forgetGame(this.code)
  }

  private dropSeat(playerId: string, lost: boolean) {
    const seats = this.snap.seats.filter((s) => s.playerId !== playerId)
    const active = this.snap.seat?.playerId === playerId ? (seats[0]?.playerId ?? null) : (this.snap.seat?.playerId ?? null)
    this.persistSeats(seats, active)
    if (lost && seats.length === 0) this.set({ seatLost: true })
  }

  private importSeatFromHash() {
    const parsed = parseSeatHash(window.location.hash)
    if (!parsed) return
    this.addSeat({ ...parsed, name: "" })
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    } catch {
      // ignore
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────
  private async run<T extends { state?: GameState }>(key: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
    this.set({ pending: key })
    const seatId = this.snap.seat?.playerId
    const sent = Date.now()
    const res = await fn()
    if (res.ok && res.state) {
      // A reply for a seat this phone has since switched away from is not shown.
      if (this.snap.seat?.playerId === seatId) this.apply(res.state, Date.now() - sent)
      else void this.refresh()
    } else if (!res.ok && res.error === "no_seat") void this.refresh()
    this.set({ pending: null, online: res.ok || res.error !== "network" })
    return res
  }

  /** Join the game from this phone (also used to add a second player on it). */
  async join(name: string): Promise<Result> {
    this.set({ pending: "join" })
    const res = await api.join(this.code, name)
    if (res.ok) {
      rememberName(name.trim())
      this.addSeat({ playerId: res.playerId, token: res.token, name: name.trim() })
      await this.refresh()
    } else {
      // e.g. the game just finished: show the latest picture.
      void this.refresh()
    }
    this.set({ pending: null })
    return res.ok ? { ok: true } : res
  }

  addWord(text: string) {
    const token = this.snap.seat?.token
    if (!token) return Promise.resolve<Result>({ ok: false, error: "no_seat" })
    return this.run("word:add", () => api.addWord(this.code, token, text))
  }

  removeWord(wordId: string) {
    const token = this.snap.seat?.token
    if (!token) return Promise.resolve<Result>({ ok: false, error: "no_seat" })
    return this.run("word:remove", () => api.removeWord(this.code, token, wordId))
  }

  /** Host-only actions. `settings` takes a partial Settings object. */
  host(action: HostAction, payload: Record<string, unknown> | Partial<Settings> = {}) {
    const token = this.snap.seat?.token
    if (!token) return Promise.resolve<Result<{ token?: string; playerId?: string; name?: string }>>({ ok: false, error: "no_seat" })
    return this.run(`host:${action}`, () => api.host(this.code, token, action, payload as Record<string, unknown>))
  }

  /** Host: take over another player's seat on THIS phone (dead battery etc.). */
  async takeSeat(playerId: string): Promise<Result> {
    const mine = this.snap.seat
    // Reissuing your own seat would sign this phone out of it.
    if (mine?.playerId === playerId) return { ok: false, error: "invalid" }
    const res = await this.host("reissue", { playerId })
    if (!res.ok) return res
    if (res.token && res.playerId) {
      const seats = [...this.snap.seats.filter((s) => s.playerId !== res.playerId), { playerId: res.playerId, token: res.token, name: res.name ?? "" }]
      // If they are up right now, hand them the screen at once (while paused,
      // stay as the host so Resume is still there); otherwise keep playing as
      // yourself and the store swaps seats when their turn comes.
      const st = this.snap.state
      const t = st && st.status === "playing" ? st.turn : null
      const upNow = !!t && t.playerId === res.playerId && (t.state === "ready" || t.state === "active" || t.state === "review")
      this.persistSeats(seats, upNow ? res.playerId : (mine?.playerId ?? res.playerId))
      if (upNow) void this.refresh()
    }
    return { ok: true }
  }

  /** Host: a link that seats `playerId` on whichever phone opens it. */
  async seatLink(playerId: string): Promise<Result<{ url: string }>> {
    if (this.snap.seat?.playerId === playerId) return { ok: false, error: "invalid" }
    const res = await this.host("reissue", { playerId })
    if (!res.ok) return res
    // The old token is dead: if this phone was holding that seat, let it go.
    if (this.snap.seats.some((s) => s.playerId === playerId)) this.dropSeat(playerId, false)
    const url =`${window.location.origin}/saladbowl/${this.code}#seat=${res.playerId}.${res.token}`
    return { ok: true, url }
  }

  private turn(action: TurnAction, payload: Record<string, unknown> = {}) {
    const token = this.snap.seat?.token
    if (!token) return Promise.resolve<Result>({ ok: false, error: "no_seat" })
    return this.run(`turn:${action}`, () => api.turn(this.code, token, action, payload))
  }

  /** Clue-giver: start the clock. */
  startTurn() {
    return this.turn("start")
  }
  /** Clue-giver: the team got the word on screen. */
  correct() {
    const word = this.snap.state?.turn?.word
    if (!word) return Promise.resolve<Result>({ ok: true })
    return this.turn("correct", { wordId: word.id })
  }
  /** Clue-giver: skip the word on screen (if the rule allows). */
  skip() {
    const word = this.snap.state?.turn?.word
    if (!word) return Promise.resolve<Result>({ ok: true })
    return this.turn("skip", { wordId: word.id })
  }
  /** Clue-giver: take back the last "got it". */
  undo() {
    return this.turn("undo", { got: String(this.snap.state?.turn?.got ?? 0) })
  }
  /** Review: mark a word from this turn as got / not got. */
  toggleWord(wordId: string, got: boolean) {
    return this.turn("toggle", { wordId, got })
  }
  /** Leave the review / round-end screen (pass the mic, or start the next round). */
  advance() {
    return this.turn("advance", { since: this.snap.state?.turn?.since ?? 0 })
  }
}

// ─── hooks ───────────────────────────────────────────────────────────────────

const stores = new Map<string, GameStore>()

function getStore(code: string, spectator: boolean): GameStore {
  if (typeof window === "undefined") return new GameStore(code, spectator)
  const key = `${code.toUpperCase()}:${spectator ? "tv" : "play"}`
  let store = stores.get(key)
  if (!store) {
    store = new GameStore(code, spectator)
    stores.set(key, store)
  }
  return store
}

/** The live game for `code`. Render the caller with key={code}. */
export function useGame(code: string, spectator = false): { store: GameStore; snap: Snapshot } {
  const [store] = useState(() => getStore(code, spectator))
  useEffect(() => {
    store.mount()
    return () => store.unmount()
  }, [store])
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  return { store, snap }
}

/** Start a new game and seat the host on this phone. Returns the code. */
export async function createGame(name: string, settings: Partial<Settings> = {}): Promise<Result<{ code: string }>> {
  const res = await api.create(name, settings)
  if (!res.ok) return res
  rememberName(name.trim())
  saveSeats(res.code, { active: res.playerId, seats: [{ playerId: res.playerId, token: res.token, name: name.trim() }] })
  return { ok: true, code: res.code }
}

// A shared ticking clock, so components can show countdowns without calling
// Date.now() during render (which the React compiler rules forbid).
const clock = {
  now: 0,
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setInterval> | null,
}
function subscribeClock(listener: () => void) {
  clock.listeners.add(listener)
  if (!clock.timer) {
    clock.now = Date.now()
    clock.timer = setInterval(() => {
      clock.now = Date.now()
      clock.listeners.forEach((l) => l())
    }, 100)
  }
  return () => {
    clock.listeners.delete(listener)
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer)
      clock.timer = null
    }
  }
}

// Must return the same value until the next tick (useSyncExternalStore rule).
function readClock(): number {
  if (!clock.now) clock.now = Date.now()
  return clock.now
}

/** This phone's clock in ms, refreshed ~10×/s while mounted (0 on the server). */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, readClock, () => 0)
}

/** Milliseconds left until a server timestamp (never negative). */
export function useCountdown(endsAt: number | null | undefined, offset: number): number {
  const now = useNow()
  if (!endsAt || !now) return 0
  return Math.max(0, endsAt - (now + offset))
}

/** Milliseconds since a server timestamp (never negative). */
export function useElapsed(since: number | null | undefined, offset: number): number {
  const now = useNow()
  if (!since || !now) return 0
  return Math.max(0, now + offset - since)
}
