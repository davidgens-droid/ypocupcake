"use client"

// Salad Bowl — team scores as coloured bars. Used on the phones (compact, at
// the top of every in-game screen), on the set-break and finale screens, and
// on the big screen.
import type { CSSProperties } from "react"

import type { GameState } from "@/lib/saladbowl/types"

import { cx } from "./ui"

/**
 * Team scores as a stack of coloured bars.
 * activeTeam: outline the team whose turn it is. round: also show "+n" won in that round.
 * size "sm": one compact row for the top of a phone screen. "lg": the TV.
 */
export function Scoreboard({
  state,
  activeTeam,
  round,
  size,
}: {
  state: GameState
  activeTeam?: number | null
  round?: number | null
  size?: "sm" | "lg"
}) {
  const teams = state.teams
  const showRound = round != null
  const wonIn = (team: number) => (round != null ? (teams[team]?.rounds?.[round] ?? 0) : 0)

  if (size === "sm") {
    // Two teams sit side by side as little bars; three or four become tiles
    // with the name over the number so nothing gets squeezed on a narrow phone.
    const stacked = teams.length > 2
    const tile: CSSProperties = {
      flexDirection: stacked ? "column" : "row",
      alignItems: stacked ? "stretch" : "center",
      gap: stacked ? 2 : 8,
      padding: stacked ? "6px 8px 5px" : "7px 12px 6px",
      borderWidth: 2.5,
      borderRadius: 10,
      boxShadow: "3px 3px 0 rgba(0, 0, 0, 0.4)",
      minWidth: 0,
    }
    return (
      <div
        role="list"
        aria-label="Scores"
        style={{ display: "grid", gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))`, gap: 9 }}
      >
        {teams.map((t, i) => (
          <div
            key={i}
            role="listitem"
            className={cx("sb-score", activeTeam === i && "sb-score--up")}
            data-team={i}
            style={tile}
            aria-label={`${t.name}: ${t.score}${activeTeam === i ? ", playing now" : ""}`}
          >
            <span className="sb-score-name" style={{ fontSize: stacked ? "0.8rem" : "1rem", flex: stacked ? "none" : 1 }}>
              {t.name}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: stacked ? "space-between" : "flex-end",
                gap: 6,
              }}
            >
              <span key={t.score} className="sb-score-num sb-pop" style={{ fontSize: "1.55rem", minWidth: 0 }}>
                {t.score}
              </span>
              {showRound && (
                <span className="sb-cond" style={{ fontSize: "0.82rem" }}>
                  +{wonIn(i)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const lg = size === "lg"
  return (
    <div role="list" aria-label="Scores" style={{ display: "flex", flexDirection: "column", gap: lg ? 20 : 13 }}>
      {teams.map((t, i) => (
        <div
          key={i}
          role="listitem"
          className={cx("sb-score", activeTeam === i && "sb-score--up")}
          data-team={i}
          style={lg ? { padding: "16px 24px 14px", gap: 20, borderWidth: 4, borderRadius: 18 } : undefined}
          aria-label={`${t.name}: ${t.score}${showRound ? `, ${wonIn(i)} this set` : ""}${activeTeam === i ? ", playing now" : ""}`}
        >
          {/* Long band names wrap onto a second line here rather than being cut off. */}
          <span
            className="sb-score-name"
            style={{ whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere", ...(lg ? { fontSize: "clamp(1.6rem, 3.4vw, 3.2rem)" } : null) }}
          >
            {t.name}
          </span>
          {showRound && (
            <span className="sb-label" style={lg ? { fontSize: "clamp(0.85rem, 1.4vw, 1.3rem)" } : undefined}>
              +{wonIn(i)} this set
            </span>
          )}
          <span
            key={t.score}
            className="sb-score-num sb-pop"
            style={lg ? { fontSize: "clamp(2.8rem, 6vw, 5.6rem)" } : undefined}
          >
            {t.score}
          </span>
        </div>
      ))}
    </div>
  )
}
