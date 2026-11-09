"use client"

// Salad Bowl — the encore screen. The game is over: who won, how each set
// went, tonight's awards, and the reveal everyone wants (who wrote what).
// The host can call an encore, which sends everyone back to the lobby.
import { useState, type CSSProperties } from "react"
import Link from "next/link"

import { errorText } from "@/lib/saladbowl/api"
import { ROUNDS, clock, ordinal } from "@/lib/saladbowl/content"
import { withProfile } from "@/lib/saladbowl/seats"
import type { GameState, Team } from "@/lib/saladbowl/types"

import type { ScreenProps } from "./props"
import { TopBar } from "./room-bar"
import { Scoreboard } from "./scoreboard"
import { Button, Card, Confetti, Display, Kicker, Label, Liner, Marker, Page, Stamp, TeamDot, TempoBadge, toast } from "./ui"

// ─── the facts of the night (shared with the big screen) ─────────────────────

export interface RankedTeam extends Team {
  /** Team number (its colour). */
  index: number
}

export interface AwardFact {
  key: "mvp" | "bestTurn" | "fastest"
  title: string
  /** The big line: a player's name, or the word itself. */
  headline: string
  detail: string
  /** Short rubber-stamp text, e.g. "14 words". */
  stamp: string
  team: number | null
  bar: "yellow" | "cyan" | "purple"
}

export interface WordFact {
  text: string
  author: string
  authorId: string
  ms: number
  skips: number
  hardest: boolean
  easiest: boolean
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Everything the finale needs, worked out once from the final state. */
export function finaleFacts(state: GameState) {
  const ranked: RankedTeam[] = state.teams.map((t, index) => ({ ...t, index }))
  const topScore = ranked.reduce((m, t) => Math.max(m, t.score), Number.NEGATIVE_INFINITY)
  const winners = ranked.filter((t) => t.score === topScore)
  const final = state.final
  const player = (id: string) => state.players.find((p) => p.id === id) ?? null
  const setName = (round: number) => {
    const type = state.settings.rounds[round]
    return type && ROUNDS[type] ? ROUNDS[type].name : null
  }

  // An award is skipped when its player has since left the game.
  const awards: AwardFact[] = []
  if (final?.mvp) {
    const p = player(final.mvp.playerId)
    if (p) {
      awards.push({
        key: "mvp",
        title: "MVP",
        headline: p.name,
        detail: `Landed ${plural(final.mvp.count, "word")} as clue-giver. Nobody did more.`,
        stamp: plural(final.mvp.count, "word"),
        team: p.team,
        bar: "yellow",
      })
    }
  }
  if (final?.bestTurn) {
    const p = player(final.bestTurn.playerId)
    if (p) {
      const name = setName(final.bestTurn.round)
      awards.push({
        key: "bestTurn",
        title: "Best single turn",
        headline: p.name,
        detail: `${plural(final.bestTurn.count, "word")} in one turn, during Set ${final.bestTurn.round + 1}${name ? ` (${name})` : ""}.`,
        stamp: `${final.bestTurn.count} in one go`,
        team: p.team,
        bar: "cyan",
      })
    }
  }
  if (final?.fastest) {
    const p = player(final.fastest.playerId)
    if (p) {
      const secs = (final.fastest.ms / 1000).toFixed(1)
      awards.push({
        key: "fastest",
        title: "Fastest word",
        headline: final.fastest.text,
        detail: `Guessed in ${secs} seconds. The clue came from ${p.name}.`,
        stamp: `${secs} sec`,
        team: p.team,
        bar: "purple",
      })
    }
  }

  // Hardest first. A word with no time against it was never timed, so it
  // can't be the hardest or the easiest.
  const sorted = [...(final?.words ?? [])].sort(
    (a, b) => b.ms - a.ms || b.skips - a.skips || a.text.localeCompare(b.text)
  )
  const timed = sorted.filter((w) => w.ms > 0).length
  const words: WordFact[] = sorted.map((w, i) => ({
    ...w,
    hardest: timed > 0 && i === 0,
    easiest: timed > 1 && i === timed - 1,
  }))

  const setsPlayed = Math.min(
    state.settings.rounds.length,
    ranked.reduce((m, t) => Math.max(m, t.rounds.length), 0)
  )

  return { ranked, winners, topScore: winners.length ? topScore : 0, awards, words, setsPlayed }
}

export type FinaleFacts = ReturnType<typeof finaleFacts>

// ─── the screen ──────────────────────────────────────────────────────────────

/** Team names run from 1 to 24 characters: shrink the headline to suit. */
function heroSize(name: string): string {
  if (name.length <= 8) return "clamp(3.6rem, 21vw, 6.4rem)"
  if (name.length <= 14) return "clamp(3rem, 15.5vw, 5rem)"
  return "clamp(2.4rem, 12vw, 3.9rem)"
}

/** The line about this phone's own team: a cheer, or a good-sport nod. */
function myLine(state: GameState, facts: FinaleFacts): { won: boolean; text: string } | null {
  const team = state.me?.team
  if (team == null) return null
  const mine = facts.ranked[team]
  if (!mine) return null
  if (facts.winners.some((t) => t.index === team)) {
    return { won: true, text: facts.winners.length > 1 ? "That's you, sharing the crown." : "That's you." }
  }
  const place = 1 + facts.ranked.filter((t) => t.score > mine.score).length
  const behind = facts.topScore - mine.score
  return {
    won: false,
    text: `Not your night. ${mine.name} came ${ordinal(place)}, ${plural(behind, "point")} behind. Take a bow anyway.`,
  }
}

export function Finale({ store, snap, state }: ScreenProps) {
  const [confirming, setConfirming] = useState(false)
  const facts = finaleFacts(state)
  const me = state.me
  const solo = facts.winners.length === 1 ? facts.winners[0] : null
  const host = state.players.find((p) => p.host) ?? null
  const busy = snap.pending === "host:rematch"
  const mine = myLine(state, facts)
  const points = facts.topScore === 1 ? "Point" : "Points"

  async function encore() {
    const res = await store.host("rematch")
    if (!res.ok) {
      toast(errorText(res.error), true)
      setConfirming(false)
    }
  }

  return (
    <Page tone={solo ? "team" : "black"} team={solo?.index}>
      <Confetti />
      <TopBar store={store} snap={snap} state={state} />

      {solo ? (
        <header className="sb-pop" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
              <Label>{"That's a wrap"}</Label>
              <Kicker tone="ink">{"Tonight's headliner"}</Kicker>
            </div>
            <div style={{ transform: "rotate(8deg)", flex: "none" }}>
              <TempoBadge value={solo.score} top="Final" bottom={points} size={112} />
            </div>
          </div>
          <Display variant="pop-soft" size={heroSize(solo.name)}>
            {solo.name}
          </Display>
          <Display as="p" size="clamp(1.9rem, 9.5vw, 3rem)">
            wins the night
          </Display>
        </header>
      ) : (
        <header className="sb-pop" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
              <Label tone="yellow">{"That's a wrap"}</Label>
              <Kicker>Nobody blinked</Kicker>
            </div>
            <div
              style={{ transform: "rotate(8deg)", flex: "none", background: "var(--sb-yellow)", borderRadius: "50%", padding: 5 }}
            >
              <TempoBadge value={facts.topScore} top="Tied at" bottom={points} size={104} ring="var(--sb-yellow)" />
            </div>
          </div>
          <Display variant="glow" size="clamp(3.6rem, 21vw, 6.4rem)">
            {"It's a tie"}
          </Display>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {facts.winners.map((t, i) => (
              <div key={t.index} data-team={t.index}>
                {i > 0 && <Kicker tone="muted">and</Kicker>}
                <Display as="p" size="clamp(2rem, 10.5vw, 3.4rem)" style={{ color: "var(--sb-team)" }}>
                  {t.name}
                </Display>
              </div>
            ))}
          </div>
          <Display as="p" size="clamp(1.5rem, 7.5vw, 2.4rem)">
            share the night
          </Display>
        </header>
      )}

      {mine &&
        (mine.won ? (
          <div style={{ display: "flex", justifyContent: "flex-start", padding: "2px 4px" }}>
            <Stamp tone={solo ? "ink" : "yellow"} className="sb-wiggle">
              {mine.text}
            </Stamp>
          </div>
        ) : (
          <p style={{ margin: 0, fontWeight: 600 }}>{mine.text}</p>
        ))}

      <Liner label="Final score">
        <Scoreboard state={state} />
      </Liner>

      {facts.setsPlayed > 0 && <SetBySet state={state} facts={facts} />}

      {facts.awards.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 6 }}>
          <Kicker tone={solo ? "ink" : undefined}>{"Tonight's awards"}</Kicker>
          {facts.awards.map((a, i) => (
            <Card key={a.key} tape bar={a.bar} tilt={i % 2 ? "r" : "l"} className="sb-rise" style={{ animationDelay: `${0.15 * i}s` }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <Kicker tone="ink">{a.title}</Kicker>
                  <Display as="h3" size="clamp(1.8rem, 9vw, 2.5rem)" style={{ margin: "4px 0 6px" }}>
                    {a.headline}
                  </Display>
                </div>
                <div style={{ flex: "none", paddingTop: 4 }}>
                  <Stamp tone="ink">{a.stamp}</Stamp>
                </div>
              </div>
              <p style={{ margin: 0 }}>{a.detail}</p>
              {a.team != null && state.teams[a.team] && (
                <p className="sb-cond" style={{ margin: "8px 0 0", display: "flex", alignItems: "center", gap: 7, fontSize: "0.86rem" }}>
                  <TeamDot team={a.team} />
                  {state.teams[a.team].name}
                </p>
              )}
            </Card>
          ))}
        </section>
      )}

      {facts.words.length > 0 && <WhoWroteThat facts={facts} myId={me?.id ?? null} myTeam={me?.team ?? null} />}

      <section style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10, textAlign: "center" }}>
        {me?.host ? (
          <>
            {!confirming ? (
              <Button variant={solo?.index === 2 ? "pink" : "yellow"} disabled={busy} onClick={() => setConfirming(true)}>
                Encore
              </Button>
            ) : (
              <Card style={{ textAlign: "left" }}>
                <h2 className="sb-card-title">Play it again?</h2>
                <p style={{ margin: "0 0 14px" }}>
                  Everyone goes back to soundcheck to write new words. Tonight&apos;s scores are wiped.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Button variant="pink" disabled={busy} onClick={encore}>
                    {busy ? "Resetting the stage" : "Yes, encore"}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                    Not yet
                  </Button>
                </div>
              </Card>
            )}
            <p style={{ margin: 0, fontWeight: 600 }}>Same crowd, same teams, empty bowl.</p>
          </>
        ) : (
          <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
            Waiting for {host ? host.name : "the host"} to call an encore.
          </p>
        )}
        <div>
          <Link
            className="sb-link"
            href={withProfile("/saladbowl")}
            style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
          >
            Start a brand-new game
          </Link>
        </div>
      </section>
    </Page>
  )
}

// ─── set-by-set table ────────────────────────────────────────────────────────

const TH: CSSProperties = {
  padding: "0 4px 6px",
  fontSize: "0.68rem",
  lineHeight: 1.15,
  letterSpacing: "0.06em",
  textAlign: "center",
  verticalAlign: "bottom",
  borderBottom: "2.5px solid var(--sb-ink)",
}
const TD: CSSProperties = {
  padding: "9px 4px 7px",
  textAlign: "center",
  borderBottom: "1px dashed rgba(12, 12, 14, 0.22)",
  fontFamily: "var(--sb-display)",
  fontSize: "1.25rem",
  lineHeight: 1,
}

function SetBySet({ state, facts }: { state: GameState; facts: FinaleFacts }) {
  const sets = state.settings.rounds.slice(0, facts.setsPlayed)
  const best = sets.map((_, i) => facts.ranked.reduce((m, t) => Math.max(m, t.rounds[i] ?? 0), 0))
  const adjusted = facts.ranked.filter((t) => t.adjust !== 0)
  return (
    <Card tape tilt="r" style={{ marginTop: 8 }}>
      <h2 className="sb-card-title">Set by set</h2>
      <div style={{ overflowX: "auto", margin: "0 -4px" }}>
        <table style={{ width: "100%", minWidth: 108 + sets.length * 46 + 46, borderCollapse: "collapse" }}>
          <thead>
            <tr className="sb-cond">
              <th scope="col" style={{ ...TH, textAlign: "left" }}>
                Team
              </th>
              {sets.map((type, i) => (
                <th key={i} scope="col" style={TH}>
                  <span style={{ display: "block", opacity: 0.6 }}>Set {i + 1}</span>
                  {ROUNDS[type]?.name ?? "Set"}
                </th>
              ))}
              <th scope="col" style={TH}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {facts.ranked.map((t) => (
              <tr key={t.index}>
                <th scope="row" style={{ ...TD, textAlign: "left", fontFamily: "var(--sb-cond)", fontSize: "0.95rem" }}>
                  <span className="sb-cond" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <TeamDot team={t.index} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 96 }}>{t.name}</span>
                  </span>
                </th>
                {sets.map((_, i) => {
                  const n = t.rounds[i] ?? 0
                  const top = n > 0 && n === best[i]
                  return (
                    <td key={i} style={TD}>
                      <span
                        style={{
                          display: "inline-block",
                          minWidth: "1.9em",
                          padding: "3px 5px 2px",
                          borderRadius: 6,
                          background: top ? "var(--sb-yellow)" : undefined,
                        }}
                      >
                        {n}
                      </span>
                    </td>
                  )
                })}
                <td style={{ ...TD, fontSize: "1.5rem" }}>{t.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adjusted.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>
          Totals include a host adjustment: {adjusted.map((t) => `${t.name} ${t.adjust > 0 ? "+" : ""}${t.adjust}`).join(", ")}.
        </p>
      )}
    </Card>
  )
}

// ─── who wrote that? ─────────────────────────────────────────────────────────

function WhoWroteThat({ facts, myId, myTeam }: { facts: FinaleFacts; myId: string | null; myTeam: number | null }) {
  return (
    <Card tape="corners" style={{ marginTop: 12 }}>
      <div className="sb-setlist">
        <div className="sb-setlist-head">
          <span>Who wrote that?</span>
          <span style={{ fontSize: "0.68rem", opacity: 0.7, textAlign: "right" }}>Hardest first</span>
        </div>
        <p style={{ margin: "4px 0 6px", fontSize: "0.9rem" }}>
          Every word from the bowl, and the time it took to guess across all the sets.
        </p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {facts.words.map((w, i) => {
            const mine = myId != null && w.authorId === myId
            return (
              <li
                key={`${w.authorId}:${w.text}:${i}`}
                className="sb-row"
                data-team={mine ? (myTeam ?? 0) : undefined}
                style={
                  mine
                    ? { alignItems: "flex-start", background: "var(--sb-team-soft)", margin: "0 -10px", padding: "10px", borderRadius: 6 }
                    : { alignItems: "flex-start" }
                }
              >
                <span className="sb-row-key" style={{ minWidth: 26, paddingTop: 3 }}>
                  {i + 1}
                </span>
                <div className="sb-row-grow">
                  <div className="sb-row-title" style={{ overflowWrap: "anywhere" }}>
                    {w.text}
                  </div>
                  <div className="sb-cond" style={{ fontSize: "0.84rem", marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ opacity: 0.72 }}>by {w.author}</span>
                    {mine && <Label>Yours</Label>}
                  </div>
                  {w.skips > 0 && (
                    <div style={{ fontSize: "0.86rem", marginTop: 2, fontStyle: "italic" }}>
                      skipped {w.skips === 1 ? "once" : `${w.skips} times`}
                    </div>
                  )}
                  {w.hardest && (
                    <div style={{ marginTop: 5 }}>
                      <Marker arrow="left">the hardest one</Marker>
                    </div>
                  )}
                  {w.easiest && (
                    <div style={{ marginTop: 5 }}>
                      <Marker tone="blue" arrow="left">
                        easiest of the night
                      </Marker>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  {w.ms > 0 ? (
                    <div className="sb-row-title">{clock(w.ms)}</div>
                  ) : (
                    <div className="sb-cond" style={{ fontSize: "0.72rem", opacity: 0.7, paddingTop: 4 }}>
                      not timed
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
