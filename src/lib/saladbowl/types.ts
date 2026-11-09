// Salad Bowl — the shape of the game as the database hands it to one phone.
// Mirrors saladbowl__state() in supabase/migrations/0026_saladbowl.sql.
// Salad Bowl is a standalone party game; nothing here touches Cupcake.

/** A game is always these three rounds; the host only chooses their order. */
export type RoundType = "describe" | "charades" | "oneword"
export type SkipRule = "none" | "one" | "unlimited"
export type GameStatus = "lobby" | "playing" | "finished"
/** ready = waiting for the clue-giver to hit start; review = turn over, tally check. */
export type TurnState = "ready" | "active" | "paused" | "review" | "round_end"

export interface Settings {
  /** Free-text theme the host sets, e.g. "90s movies". May be "". */
  theme: string
  /** "" or a single capital letter every word must start with (enforced). */
  letter: string
  wordsPerPlayer: number // 1–10
  turnSeconds: number // 15–180
  skipRule: SkipRule
  /** Empty the bowl with time left → keep those seconds into the next round. */
  carryOver: boolean
  /**
   * House rule: no names of people, places, brands or titles. Shown to
   * everyone while they write and obeyed by the idea helper; the game does
   * not check words against it. Games created before this rule existed have
   * no value here, so always test it with `=== true`.
   */
  noProperNouns?: boolean
  teams: { name: string }[] // 2–4; index = team number
  rounds: RoundType[] // always all three, in play order
}

export interface Team {
  name: string
  score: number
  /** Manual +/- the host applied (already included in score). */
  adjust: number
  /** Points won in each round played so far (index = round). */
  rounds: number[]
}

export interface Player {
  id: string
  name: string
  team: number | null
  host: boolean
  seat: number
  /** Their phone checked in within the last ~20s. */
  online: boolean
  /** How many words they have written. */
  words: number
  /** Words their team guessed while they were giving clues. */
  got: number
}

export interface Me {
  id: string
  name: string
  team: number | null
  host: boolean
  /** Only your own words — nobody else's are ever sent to your phone. */
  words: { id: string; text: string }[]
}

export interface ReviewWord {
  id: string
  text: string
  got: boolean
  /** The word that was on screen when the buzzer went (clue-giver only). */
  buzzer: boolean
}

export interface Turn {
  state: TurnState
  no: number
  team: number
  playerId: string
  /** Server epoch ms when the clock runs out (active only). */
  endsAt: number | null
  /** Paused: ms left. Ready: carried-over ms this turn will start with (else null). */
  remainingMs: number | null
  /** Words won so far this turn. */
  got: number
  skips: number
  canSkip: boolean
  /** Why the turn ended: buzzer, bowl emptied, or the host stopped it. */
  reason: "time" | "bowl" | "host" | null
  leftoverMs: number | null
  /** round_end: the same player will open the next round with leftover time. */
  carryNext: boolean
  /** Server epoch ms this screen started — send back with "advance". */
  since: number
  /** The live word. Non-null ONLY for the clue-giver while the clock runs. */
  word: { id: string; text: string } | null
  /** review: this turn's words (clue-giver sees all, others only the won ones). */
  words: ReviewWord[]
}

export interface Final {
  mvp: { playerId: string; count: number } | null
  bestTurn: { playerId: string; count: number; round: number } | null
  fastest: { text: string; ms: number; playerId: string; round: number } | null
  /** Every word, who wrote it, total ms it took across rounds, times skipped. */
  words: { text: string; author: string; authorId: string; ms: number; skips: number }[]
}

export interface GameState {
  id: string
  code: string
  v: number
  /** Server epoch ms when this snapshot was built. */
  now: number
  status: GameStatus
  settings: Settings
  teams: Team[]
  players: Player[]
  /** null = spectator (TV screen) or not seated yet. */
  me: Me | null
  bowl: { total: number; left: number }
  round: { index: number; type: RoundType; count: number }
  /** null in the lobby. */
  turn: Turn | null
  /** Who is up after the current turn (round_end: who opens the next round). */
  onDeck: { team: number; playerId: string } | null
  /** Only when finished. */
  final: Final | null
}

/** A seat on this phone: no accounts, the token IS the player. */
export interface Seat {
  playerId: string
  token: string
  name: string
}

export type Ok<T = object> = { ok: true } & T
export type Fail = { ok: false; error: string }
export type Result<T = object> = Ok<T> | Fail
