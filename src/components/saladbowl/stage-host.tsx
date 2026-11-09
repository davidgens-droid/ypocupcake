"use client"

// Salad Bowl — the host's controls during a game: the clock, score fixes,
// timer and skip rule, the roster, and the two big red switches.
import { useState } from "react"
import { Minus, Pause, Play, Plus, SkipForward, Square } from "lucide-react"

import { SKIP_RULES, TURN_LENGTHS } from "@/lib/saladbowl/content"
import type { SkipRule } from "@/lib/saladbowl/types"

import { PlayerSheet } from "./player-sheet"
import type { ScreenProps } from "./props"
import { attempt, playerById, teamName } from "./stage-util"
import { Button, Kicker, Sheet, TeamDot, cx } from "./ui"

const SKIP_ORDER: SkipRule[] = ["none", "one", "unlimited"]

export function HostSheet({ store, snap, state, open, onClose }: ScreenProps & { open: boolean; onClose: () => void }) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<"end" | "lobby" | null>(null)

  const turn = state.turn
  const busy = snap.pending?.startsWith("host:") ?? false
  // If the picked player vanishes (removed), fall back to the host sheet.
  const playerId = open && playerById(state, pickedId) ? pickedId : null
  const giver = playerById(state, turn?.playerId)

  const lengths = TURN_LENGTHS.includes(state.settings.turnSeconds)
    ? TURN_LENGTHS
    : [...TURN_LENGTHS, state.settings.turnSeconds].sort((a, b) => a - b)

  const groups = [
    ...state.teams.map((_, i) => ({ team: i as number | null, players: state.players.filter((p) => p.team === i) })),
    { team: null, players: state.players.filter((p) => p.team == null || p.team >= state.teams.length) },
  ].filter((g) => g.team !== null || g.players.length > 0)

  function close() {
    setConfirm(null)
    setPickedId(null)
    onClose()
  }

  async function run(action: Parameters<typeof store.host>[0], payload: Record<string, unknown> = {}, thenClose = false) {
    const ok = await attempt(store.host(action, payload))
    if (ok && thenClose) close()
  }

  const clockLive = turn?.state === "active" || turn?.state === "paused"

  return (
    <>
      <Sheet open={open && !playerId} onClose={close} title="Host controls">
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* ── the clock ── */}
          {turn && (clockLive || turn.state === "ready") && (
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Kicker tone="ink">The clock</Kicker>
              {turn.state === "active" && (
                <Button variant="yellow" disabled={busy} onClick={() => run("pause", {}, true)}>
                  <Pause size={22} /> Pause the clock
                </Button>
              )}
              {turn.state === "paused" && (
                <Button variant="green" disabled={busy} onClick={() => run("resume", {}, true)}>
                  <Play size={22} /> Resume
                </Button>
              )}
              {clockLive && (
                <>
                  <Button variant="paper" disabled={busy} onClick={() => run("end_turn", {}, true)}>
                    <Square size={20} /> End this turn now
                  </Button>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    Ending the turn keeps the words already won and goes to the tally check.
                  </p>
                </>
              )}
              {turn.state === "ready" && (
                <>
                  <Button variant="paper" disabled={busy} onClick={() => run("skip_player", {}, true)}>
                    <SkipForward size={22} /> Skip to the next player
                  </Button>
                  <p style={{ margin: 0, fontSize: "0.92rem" }}>
                    {giver ? `${giver.name} is up but hasn't started.` : "Nobody has started yet."} Skipping hands the turn to
                    the next player on {teamName(state, turn.team)}.
                  </p>
                </>
              )}
            </section>
          )}

          {/* ── score fix ── */}
          <section>
            <Kicker tone="ink">Fix the score</Kicker>
            <div className="sb-setlist" style={{ marginTop: 6 }}>
              {state.teams.map((t, i) => (
                <div key={i} className="sb-row" data-team={i}>
                  <TeamDot team={i} />
                  <div className="sb-row-grow">
                    <div className="sb-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name}
                    </div>
                    {t.adjust !== 0 && (
                      <div className="sb-row-key">
                        Includes {t.adjust > 0 ? `+${t.adjust}` : t.adjust} from you
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="sb-iconbtn"
                    aria-label={`Take a point from ${t.name}`}
                    disabled={busy}
                    onClick={() => run("adjust", { team: i, delta: -1 })}
                  >
                    <Minus size={22} />
                  </button>
                  <span
                    key={t.score}
                    className="sb-row-title sb-pop"
                    style={{ minWidth: "2.2ch", textAlign: "center", fontSize: "1.7rem", display: "inline-block" }}
                    aria-label={`${t.name} score ${t.score}`}
                  >
                    {t.score}
                  </span>
                  <button
                    type="button"
                    className="sb-iconbtn"
                    aria-label={`Give a point to ${t.name}`}
                    disabled={busy}
                    onClick={() => run("adjust", { team: i, delta: 1 })}
                  >
                    <Plus size={22} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* ── timer + skip rule ── */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="sb-field">
              <span className="sb-fieldlabel">Seconds per turn</span>
              <div className="sb-seg" role="group" aria-label="Seconds per turn">
                {lengths.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={state.settings.turnSeconds === s}
                    disabled={busy}
                    onClick={() => {
                      if (state.settings.turnSeconds !== s) void run("settings", { turnSeconds: s })
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="sb-field">
              <span className="sb-fieldlabel">Skipping</span>
              <div className="sb-seg" role="group" aria-label="Skip rule">
                {SKIP_ORDER.map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    aria-pressed={state.settings.skipRule === rule}
                    disabled={busy}
                    onClick={() => {
                      if (state.settings.skipRule !== rule) void run("settings", { skipRule: rule })
                    }}
                  >
                    {SKIP_RULES[rule].name}
                  </button>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>{SKIP_RULES[state.settings.skipRule].detail}</p>
            </div>
            <p className="sb-cond" style={{ margin: 0, fontSize: "0.86rem" }}>
              Changes kick in from the next turn.
            </p>
          </section>

          {/* ── roster ── */}
          <section>
            <Kicker tone="ink">The line-up</Kicker>
            <p style={{ margin: "4px 0 10px", fontSize: "0.92rem" }}>
              Tap a name to move them, hand their seat to another phone, or take them out.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {groups.map((g) => (
                <div key={g.team ?? "none"} data-team={g.team ?? undefined}>
                  <div className="sb-cond" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.95rem" }}>
                    {g.team !== null && <TeamDot team={g.team} />}
                    {g.team !== null ? teamName(state, g.team) : "Not on a team"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {g.players.length === 0 && <span style={{ fontSize: "0.92rem" }}>Nobody here.</span>}
                    {g.players.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={cx("sb-chip", g.team !== null && "sb-chip--soft", !p.online && "sb-chip--off")}
                        style={{ minHeight: 44 }}
                        onClick={() => setPickedId(p.id)}
                        aria-label={`${p.name}${p.online ? "" : ", phone asleep"}${turn?.playerId === p.id ? ", up now" : ""}. Open player options`}
                      >
                        <span className={cx("sb-dot", p.online ? "sb-dot--live" : "sb-dot--away")} style={{ flex: "none" }} aria-hidden />
                        <span>{p.name}</span>
                        {p.host && <small style={{ flex: "none", opacity: 0.7 }}>host</small>}
                        {turn?.playerId === p.id && turn.state !== "round_end" && (
                          <small style={{ flex: "none" }}>up now</small>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="sb-cond" style={{ margin: "10px 0 0", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6 }}>
              <span className="sb-dot sb-dot--live" aria-hidden /> phone awake
              <span className="sb-dot sb-dot--away" style={{ marginLeft: 10 }} aria-hidden /> phone asleep
            </p>
          </section>

          {/* ── the big red switches ── */}
          <section style={{ borderTop: "2px dashed rgba(12,12,14,.4)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {confirm === null && (
              <>
                <Kicker tone="ink">Stop the show</Kicker>
                <Button variant="paper" onClick={() => setConfirm("end")}>
                  End the game now
                </Button>
                <Button variant="paper" onClick={() => setConfirm("lobby")}>
                  Back to soundcheck
                </Button>
              </>
            )}
            {confirm === "end" && (
              <>
                <Kicker tone="ink">End the game now?</Kicker>
                <p style={{ margin: 0 }}>
                  Everyone jumps straight to the final results, with the scores exactly as they stand. The rest of the sets
                  are not played.
                </p>
                <Button variant="pink" disabled={busy} onClick={() => run("end_game", {}, true)}>
                  Yes, end the game
                </Button>
                <Button variant="paper" onClick={() => setConfirm(null)}>
                  No, keep playing
                </Button>
              </>
            )}
            {confirm === "lobby" && (
              <>
                <Kicker tone="ink">Back to soundcheck?</Kicker>
                <p style={{ margin: 0 }}>
                  This game stops here. The scores are wiped and the bowl is emptied. Everyone stays on their team and writes
                  new words for a fresh game.
                </p>
                <Button variant="pink" disabled={busy} onClick={() => run("rematch", {}, true)}>
                  Yes, back to soundcheck
                </Button>
                <Button variant="paper" onClick={() => setConfirm(null)}>
                  No, keep playing
                </Button>
              </>
            )}
          </section>
        </div>
      </Sheet>
      <PlayerSheet store={store} snap={snap} state={state} playerId={playerId} onClose={() => setPickedId(null)} />
    </>
  )
}
