// Salad Bowl — talks to the saladbowl_* database functions.
//
// Uses its OWN Supabase client with no session handling, so a signed-in
// Cupcake member playing Salad Bowl never has their forum login involved:
// every call is anonymous and carries only the game code + seat token.
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { GameState, Result, Settings } from "./types"

let client: SupabaseClient | null = null

export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          // A distinct key so this client can never pick up Cupcake's session.
          storageKey: "saladbowl-anon",
        },
        realtime: { params: { eventsPerSecond: 10 } },
      }
    )
  }
  return client
}

// No reply within this long counts as a failed request, so a stalled
// connection cannot freeze syncing or leave a button stuck.
const TIMEOUT_MS = 10000

async function call<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const { data, error } = await sb().rpc(fn, args).abortSignal(ctl.signal)
    if (error) {
      // PGRST202 / 42883: the functions are not installed yet.
      const missing = error.code === "PGRST202" || error.code === "42883"
      return { ok: false, error: missing ? "not_installed" : "network" }
    }
    return data as Result<T>
  } catch {
    return { ok: false, error: "network" }
  } finally {
    clearTimeout(timer)
  }
}

export type HostAction =
  | "settings"
  | "assign"
  | "shuffle"
  | "remove"
  | "reissue"
  | "make_host"
  | "start"
  | "pause"
  | "resume"
  | "end_turn"
  | "skip_player"
  | "adjust"
  | "end_game"
  | "rematch"

export type TurnAction = "start" | "correct" | "skip" | "undo" | "toggle" | "advance"

export const api = {
  create: (name: string, settings: Partial<Settings> = {}) =>
    call<{ code: string; playerId: string; token: string }>("saladbowl_create", {
      p_name: name,
      p_settings: settings,
    }),
  join: (code: string, name: string) =>
    call<{ code: string; playerId: string; token: string }>("saladbowl_join", {
      p_code: code,
      p_name: name,
    }),
  state: (code: string, token: string | null) =>
    call<{ seat: boolean; state: GameState }>("saladbowl_state", { p_code: code, p_token: token }),
  addWord: (code: string, token: string, text: string) =>
    call<{ state: GameState }>("saladbowl_add_word", { p_code: code, p_token: token, p_text: text }),
  removeWord: (code: string, token: string, wordId: string) =>
    call<{ state: GameState }>("saladbowl_remove_word", { p_code: code, p_token: token, p_word: wordId }),
  host: (code: string, token: string, action: HostAction, payload: Record<string, unknown> = {}) =>
    call<{ state: GameState; playerId?: string; name?: string; token?: string }>("saladbowl_host", {
      p_code: code,
      p_token: token,
      p_action: action,
      p_payload: payload,
    }),
  turn: (code: string, token: string, action: TurnAction, payload: Record<string, unknown> = {}) =>
    call<{ state: GameState }>("saladbowl_turn", {
      p_code: code,
      p_token: token,
      p_action: action,
      p_payload: payload,
    }),
}

export type IdeaKind = "words" | "themes"

/** AI helper: word ideas for the current theme, or theme ideas for the host. */
export async function fetchIdeas(
  code: string,
  token: string,
  kind: IdeaKind
): Promise<Result<{ ideas: string[] }>> {
  try {
    const res = await fetch("/api/saladbowl/ideas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, token, kind }),
      // The route gives up after about 20s; never leave "Thinking" up for good.
      signal: AbortSignal.timeout(25000),
    })
    const body = (await res.json().catch(() => null)) as Result<{ ideas: string[] }> | null
    if (!body) return { ok: false, error: "network" }
    return body
  } catch {
    return { ok: false, error: "network" }
  }
}

/** Plain-English text for every error code the game can return. */
export function errorText(code: string): string {
  switch (code) {
    case "name":
      return "Pop a name in first."
    case "name_taken":
      return "Someone in this game already has that name. Try another."
    case "no_game":
      return "No game with that code. Check the four letters."
    case "game_over":
      return "That game has already finished."
    case "full":
      return "That's the limit."
    case "no_seat":
      return "This phone isn't in the game any more. Join again."
    case "locked":
      return "Too late for that. The game is already under way."
    case "invalid":
      return "That didn't look right. Try again."
    case "letter":
      return "That doesn't start with tonight's letter."
    case "one_word":
      return "One word only tonight. No spaces."
    case "every_word":
      return "Every word has to start with tonight's letter."
    case "duplicate":
      return "Great minds! That one's already in the bowl. Pick another."
    case "not_host":
      return "Only the host can do that."
    case "no_player":
      return "That player has left the game."
    case "busy":
      return "They're mid-turn. End the turn first."
    case "need_players":
      return "Every team needs at least two players."
    case "need_words":
      return "The bowl needs at least three words."
    case "not_your_turn":
      return "It's not your turn."
    case "no_skips":
      return "No skips left this turn."
    case "last_word":
      return "It's the last word in the bowl. No skipping this one."
    case "wait":
      return "Give them a second to check their words."
    case "rate_limited":
      return "Lots of games started from here just now. Try again in a bit."
    case "not_installed":
      return "Salad Bowl isn't switched on yet. The database step still needs to be run."
    case "helper_off":
      return "The host has switched the idea machine off for this game. You've got this."
    case "ai_off":
      return "The idea machine is unplugged right now."
    case "network":
      return "Couldn't reach the stage. Check your connection."
    default:
      return "Something went wrong. Try again."
  }
}
