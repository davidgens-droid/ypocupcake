// Salad Bowl — the words on the page: round rules, team colours, theme ideas.
import type { RoundType, SkipRule } from "./types"

export interface RoundInfo {
  type: RoundType
  /** Poster title. */
  name: string
  /** One line: what the clue-giver may do. */
  rule: string
  /** The fine print. */
  detail: string
}

export const ROUNDS: Record<RoundType, RoundInfo> = {
  describe: {
    type: "describe",
    name: "Say Anything",
    rule: "Describe it any way you like. Just don't say the word.",
    detail: "No saying the word itself, any part of it, rhymes-with, or spelling it out. Everything else goes.",
  },
  oneword: {
    type: "oneword",
    name: "One Word",
    rule: "One single word. That's your whole clue.",
    detail: "Pick one word and commit. You can repeat it, shout it, whisper it. No second word, no acting.",
  },
  charades: {
    type: "charades",
    name: "Charades",
    rule: "Act it out. Not a sound.",
    detail: "No talking, no humming, no sound effects, no pointing at things in the room.",
  },
}

/** The classic order. Every game plays all three; the host can reorder them. */
export const ROUND_ORDER: RoundType[] = ["describe", "charades", "oneword"]

/** Team colours, straight off the tour poster. Index = team number. */
export const TEAM_COLORS = [
  { key: "pink", hex: "#ff2e7e", soft: "#ffd0e2" },
  { key: "cyan", hex: "#1fb4f0", soft: "#cdeefc" },
  { key: "yellow", hex: "#ffc81f", soft: "#fff0b8" },
  { key: "purple", hex: "#8b6cf6", soft: "#e0d8fd" },
] as const

export function teamColor(team: number | null | undefined) {
  return TEAM_COLORS[(team ?? 0) % TEAM_COLORS.length]
}

/** Band names with a salad problem, for the "rename" dice. */
export const BAND_NAMES = [
  "Lettuce Zeppelin",
  "The Beet-les",
  "Radishhead",
  "Kale Halen",
  "Guns N' Rosemary",
  "Black Sabbasil",
  "Rage Against the Tangerine",
  "Bok Choy Division",
  "Fleetwood Mache",
  "The Rolling Scones",
  "Pearl Jam & Toast",
  "Red Hot Chili Peppers (the actual peppers)",
  "Arugula Monkeys",
  "The Smashing Pumpkin Seeds",
  "Dill Scott-Heron",
  "AC/Dressing",
  "Foo Fritters",
  "Parsley Cline",
  "Chard Day's Night",
  "The Crouton Five",
].map((n) => n.slice(0, 24))

export const THEME_PRESETS = [
  "Anything goes",
  "Famous people",
  "Movies & TV",
  "Songs & bands",
  "Things in this house",
  "Places we've been",
  "Food & drink",
  "90s nostalgia",
  "Inside jokes",
  "Things at a concert",
  "Jobs & hobbies",
  "Animals",
  "Brands",
  "Sports & games",
  "Kids' stuff",
  "Things that are too loud",
]

export const SKIP_RULES: Record<SkipRule, { name: string; detail: string }> = {
  none: { name: "No skips", detail: "You're stuck with it until they get it." },
  one: { name: "One skip a turn", detail: "One free pass each turn. The word goes back in the bowl." },
  unlimited: { name: "Skip freely", detail: "Pass as often as you like. Skipped words come back around." },
}

export const TURN_LENGTHS = [30, 45, 60, 75, 90, 120]

/** "1:05" / "0:07". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
