"use client"

// Salad Bowl — someone opened /saladbowl/CODE and this phone has no seat yet.
// Shows which game this is (so they trust it), then one field and one button.
import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react"
import Link from "next/link"
import { ArrowRight, Tv } from "lucide-react"

import { errorText } from "@/lib/saladbowl/api"
import { ROUNDS } from "@/lib/saladbowl/content"
import { lastName, withProfile } from "@/lib/saladbowl/seats"

import type { ScreenProps } from "./props"
import { Button, Card, Display, Kicker, Label, Marker, MuteButton, Page, TeamDot, cx } from "./ui"

// The remembered name lives in localStorage: read it as an external store so
// nothing is set from an effect (a string snapshot is always stable).
function subscribeStorage(listener: () => void) {
  window.addEventListener("storage", listener)
  return () => window.removeEventListener("storage", listener)
}
function serverName(): string {
  return ""
}

const rowValue: CSSProperties = { minWidth: 0, overflowWrap: "anywhere" }
const rowNote: CSSProperties = { fontSize: "0.92rem", lineHeight: 1.25, marginTop: 2 }

export function JoinScreen({ store, snap, state }: ScreenProps) {
  const savedName = useSyncExternalStore(subscribeStorage, lastName, serverName)
  // null = untouched, so the remembered name shows until they type.
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; n: number } | null>(null)

  const name = (draft ?? savedName).slice(0, 20)
  const joining = snap.pending === "join"
  const finished = state.status === "finished"
  const playing = state.status === "playing"
  const host = state.players.find((p) => p.host)
  const { settings } = state

  function fail(text: string) {
    setProblem((p) => ({ text, n: (p?.n ?? 0) + 1 }))
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    if (joining) return
    if (!name.trim()) return fail(errorText("name"))
    setProblem(null)
    const res = await store.join(name)
    if (!res.ok) {
      fail(errorText(res.error))
      // The game may have ended or changed under us: get the latest picture.
      void store.refresh()
    }
    // On success the store seats this phone and the room swaps this screen out.
  }

  const kicker = finished ? "That's a wrap" : playing ? "The show has started" : "You're on the guest list"
  const title = finished ? "Show's over" : playing ? "Jump in" : host ? `Join ${host.name}'s game` : "Join the game"

  // Teams, with anyone the host hasn't placed yet at the end.
  const groups = settings.teams.map((team, i) => ({
    key: `team-${i}`,
    team: i as number | null,
    name: team.name,
    score: state.teams[i]?.score ?? 0,
    members: state.players.filter((p) => p.team === i),
  }))
  const loose = state.players.filter((p) => p.team == null || p.team < 0 || p.team >= settings.teams.length)
  if (loose.length) groups.push({ key: "loose", team: null, name: "No team yet", score: 0, members: loose })

  const ranked = state.teams.map((team, i) => ({ ...team, i })).sort((a, b) => b.score - a.score)
  const best = ranked[0]?.score ?? 0
  const tied = ranked.filter((t) => t.score === best).length > 1

  return (
    <Page>
      <header className="sb-topbar">
        <span className="sb-topbar-code">
          <small>Game</small>
          {state.code}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Label tone="yellow">Salad Bowl</Label>
          <MuteButton />
        </div>
      </header>

      <div className="sb-pop">
        <Kicker>{kicker}</Kicker>
        <Display variant="glow" size="clamp(2.6rem, 13vw, 4.4rem)" style={{ marginTop: 6 }}>
          {title}
        </Display>
      </div>

      {snap.seatLost && (
        <Card tilt="l" className="sb-rise">
          <Marker>Your seat on this phone is gone.</Marker>
          <p style={{ margin: "8px 0 0" }}>
            The host moved it to another phone or took it out of the game.
            {!finished && " Join again below with a new name, or ask the host to send you a link to your old seat."}
          </p>
        </Card>
      )}

      {finished ? (
        <>
          {/* ── final scores ── */}
          <div className="sb-rise" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Kicker tone="muted">Final scores</Kicker>
            {ranked.map((team) => (
              <div key={team.i} className={cx("sb-score", team.score === best && "sb-score--up")} data-team={team.i}>
                <span className="sb-score-name">{team.name}</span>
                {team.score === best && <Label>{tied ? "Tied" : "Winner"}</Label>}
                <span className="sb-score-num">{team.score}</span>
              </div>
            ))}
          </div>
          <Card tape className="sb-rise">
            <h2 className="sb-card-title">This one has finished</h2>
            <p style={{ margin: "0 0 14px" }}>
              {host ? `${host.name}'s game is over, so there is nothing to join here.` : "This game is over, so there is nothing to join here."}{" "}
              Start your own. It takes about ten seconds.
            </p>
            <Link className="sb-btn" href={withProfile("/saladbowl")}>
              Start a new game <ArrowRight size={22} aria-hidden />
            </Link>
          </Card>
        </>
      ) : (
        <>
          {/* ── the one thing to do ── */}
          <Card tape bar="yellow" className="sb-rise">
            <form onSubmit={join} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {playing && (
                <p style={{ margin: 0 }}>
                  They have already started, and you can still play. You will land on a team and take a turn when it
                  comes around.
                </p>
              )}
              <div className="sb-field">
                <label htmlFor="sb-join-name">Your name</label>
                <input
                  id="sb-join-name"
                  className="sb-input"
                  value={name}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={20}
                  placeholder="Stage name"
                  autoComplete="given-name"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                />
              </div>
              {problem && (
                <p key={problem.n} className="sb-error sb-shake" role="alert" style={{ margin: 0 }}>
                  {problem.text}
                </p>
              )}
              <Button type="submit" disabled={joining}>
                {joining ? (
                  "Finding you a seat"
                ) : (
                  <>
                    {playing ? "Jump in" : "Join the game"} <ArrowRight size={22} aria-hidden />
                  </>
                )}
              </Button>
              <p className="sb-muted" style={{ margin: 0, fontSize: "0.92rem" }}>
                No account, no app. Pick a name your friends will recognise.
              </p>
            </form>
          </Card>

          {/* ── which game this is ── */}
          <Card tape="corners" className="sb-rise">
            <div className="sb-setlist">
              <div className="sb-setlist-head">
                <span>Tonight&apos;s show</span>
                <span>{state.code}</span>
              </div>
              {host && (
                <div className="sb-row">
                  <span className="sb-row-key">Host</span>
                  <span className="sb-row-title" style={rowValue}>
                    {host.name}
                  </span>
                </div>
              )}
              {settings.theme && (
                <div className="sb-row">
                  <span className="sb-row-key">Theme</span>
                  <span className="sb-row-title" style={rowValue}>
                    {settings.theme}
                  </span>
                </div>
              )}
              {settings.letter && !playing && (
                <div className="sb-row">
                  <span className="sb-row-key">Letter</span>
                  <div className="sb-row-grow">
                    <div className="sb-row-title">Starts with {settings.letter}</div>
                    <div style={rowNote}>Every word has to begin with it.</div>
                  </div>
                </div>
              )}
              {playing ? (
                <>
                  <div className="sb-row">
                    <span className="sb-row-key">Now</span>
                    <div className="sb-row-grow">
                      <div className="sb-row-title">
                        Set {state.round.index + 1} of {state.round.count}: {ROUNDS[state.round.type].name}
                      </div>
                      <div style={rowNote}>{ROUNDS[state.round.type].rule}</div>
                    </div>
                  </div>
                  <div className="sb-row">
                    <span className="sb-row-key">Bowl</span>
                    <div className="sb-row-grow">
                      <div className="sb-row-title">
                        {state.bowl.left} of {state.bowl.total} words left
                      </div>
                      <div style={rowNote}>The bowl is already full, so you won&apos;t write any.</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="sb-row">
                  <span className="sb-row-key">Words</span>
                  <div className="sb-row-grow">
                    <div className="sb-row-title">
                      {settings.wordsPerPlayer} {settings.wordsPerPlayer === 1 ? "word" : "words"} each
                    </div>
                    <div style={rowNote}>You write yours in secret once you are in.</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <Kicker tone="ink">
                Already in: {state.players.length} {state.players.length === 1 ? "player" : "players"}
              </Kicker>
              {groups.map((group) => (
                <div key={group.key} data-team={group.team ?? undefined}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {group.team != null && <TeamDot team={group.team} />}
                    <span className="sb-cond" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                      {group.name}
                    </span>
                    {playing && group.team != null && (
                      <span className="sb-cond">
                        {group.score} {group.score === 1 ? "point" : "points"}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {group.members.map((p) => (
                      <span key={p.id} className={cx("sb-chip", group.team != null && "sb-chip--soft")}>
                        <span>{p.name}</span>
                      </span>
                    ))}
                    {group.members.length === 0 && (
                      <span className="sb-muted" style={{ fontSize: "0.92rem" }}>
                        Nobody yet. Could be you.
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Link
        className="sb-link"
        href={withProfile(`/saladbowl/${state.code}/tv`)}
        style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, marginTop: "auto" }}
      >
        <Tv size={18} aria-hidden /> Just watching? Open the big screen
      </Link>
    </Page>
  )
}
