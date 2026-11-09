"use client"

// Salad Bowl — small helpers shared by the in-game ("stage") screens.
import type { ReactNode } from "react"

import { errorText } from "@/lib/saladbowl/api"
import { useElapsed } from "@/lib/saladbowl/store"
import type { GameState, Me, Player, Turn } from "@/lib/saladbowl/types"

import type { ScreenProps } from "./props"
import { toast } from "./ui"

/** Everything a stage view needs to know about who is who right now. */
export interface StageProps extends ScreenProps {
  turn: Turn
  me: Me
  /** The clue-giver (undefined only if they were removed a moment ago). */
  giver: Player | undefined
  giverName: string
  isGiver: boolean
  /** On the clue-giver's team, but not the clue-giver. */
  isTeammate: boolean
  host: boolean
}

type Outcome = { ok: true } | { ok: false; error: string }

/** Run a store action; on failure say why in a toast. Resolves to "it worked". */
export async function attempt(action: Promise<Outcome>): Promise<boolean> {
  const res = await action
  if (!res.ok) toast(errorText(res.error), true)
  return res.ok
}

export function playerById(state: GameState, id: string | null | undefined): Player | undefined {
  return id ? state.players.find((p) => p.id === id) : undefined
}

export function teamName(state: GameState, team: number | null | undefined): string {
  if (team == null) return "No team"
  return state.teams[team]?.name || `Team ${team + 1}`
}

/**
 * A font-size that keeps the longest word of `text` on one line of the phone's
 * content column, so poster type shrinks for long names instead of overflowing.
 * `gutter` is the horizontal space (px) taken by page padding, card padding, etc.
 */
export function fitText(text: string, maxRem: number, minRem = 1.3, gutter = 32): string {
  const longest = text.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 4)
  // Anton's capitals run a little under half an em wide; 0.56 leaves headroom.
  const divisor = (longest * 0.56).toFixed(2)
  return `clamp(${minRem}rem, calc((min(100vw, 520px) - ${gutter}px) / ${divisor}), ${maxRem}rem)`
}

/** Font-size for the live word: fits the longest word AND keeps long phrases to a few lines. */
export function wordSize(text: string): string {
  const total = text.trim().length
  const cap = total <= 10 ? 5 : total <= 18 ? 4.2 : total <= 28 ? 3.4 : total <= 44 ? 2.7 : 2.1
  return fitText(text, cap, 1.2, 84)
}

/**
 * The stage edge: a black bar pinned to the bottom of the screen that holds
 * the one button this screen is about, so it is always under the thumb however
 * long the page gets. `reserve` is the room (px) to leave for it in the page.
 * (Pinned with position: fixed because .sb-root clips overflow, which stops
 * position: sticky from working.)
 */
export function Dock({ reserve = 96, children }: { reserve?: number; children: ReactNode }) {
  return (
    <>
      <div aria-hidden style={{ height: reserve, flex: "none" }} />
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          padding: "12px 16px max(14px, env(safe-area-inset-bottom))",
          background: "var(--sb-ink)",
          color: "#fff",
          borderTop: "3px solid rgba(255, 255, 255, 0.18)",
          boxShadow: "0 -10px 24px rgba(0, 0, 0, 0.28)",
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
      </div>
    </>
  )
}

/** "word" / "words". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

/**
 * Shows `children` only once `ms` have passed since a server timestamp
 * (`fallback` until then). Keeps the ticking clock out of the parent's render.
 */
export function After({
  since,
  offset,
  ms,
  fallback = null,
  children,
}: {
  since: number
  offset: number
  ms: number
  fallback?: ReactNode
  children: ReactNode
}) {
  const elapsed = useElapsed(since, offset)
  return <>{elapsed > ms ? children : fallback}</>
}
