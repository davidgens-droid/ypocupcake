"use client"

// Salad Bowl — the big screen. A TV or laptop the whole room can see:
// the join poster in the lobby, the clock and scores during the game, and
// the result at the end. It is a spectator: it never receives a hidden word.
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { Check } from "lucide-react"

import { ROUNDS, clock } from "@/lib/saladbowl/content"
import { withProfile } from "@/lib/saladbowl/seats"
import { unlockAudio } from "@/lib/saladbowl/sound"
import { useCountdown, useGame } from "@/lib/saladbowl/store"
import type { GameState, Turn } from "@/lib/saladbowl/types"

import { finaleFacts, plural } from "./finale"
import { Scoreboard } from "./scoreboard"
import { QrCode, joinUrl } from "./share"
import { Card, Confetti, Display, Label, Liner, Marker, MuteButton, Page, Spinner, Stamp, TeamDot, TempoBadge, Toasts, cx } from "./ui"

// ─── sizing ──────────────────────────────────────────────────────────────────
// The design system's type is sized in rem for a phone. On the big screen the
// important things scale with the viewport instead.

/** A font size that grows with the screen: clamp(min rem, vw, max rem). */
const fs = (min: number, vw: number, max: number) => `clamp(${min}rem, ${vw}vw, ${max}rem)`
const between = (min: number, value: number, max: number) => Math.round(Math.max(min, Math.min(max, value)))

function subscribeResize(listener: () => void) {
  window.addEventListener("resize", listener)
  return () => window.removeEventListener("resize", listener)
}
const readWidth = () => window.innerWidth
const readHeight = () => window.innerHeight

interface View {
  w: number
  h: number
  /** Landscape TV / laptop layout (matches the .sb-tv breakpoint). */
  wide: boolean
}

/** Viewport size, for the pieces that take a pixel size (QR code, clock badge). */
function useView(): View {
  const w = useSyncExternalStore(subscribeResize, readWidth, () => 1280)
  const h = useSyncExternalStore(subscribeResize, readHeight, () => 720)
  return { w, h, wide: w >= 900 }
}

/** Two columns on a wide screen, one on a phone. No media query needed. */
const COLUMNS: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
  gap: "clamp(20px, 3.2vw, 56px)",
  alignItems: "start",
  alignContent: "center",
  flex: 1,
}
const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: "clamp(12px, 1.6vw, 24px)", minWidth: 0 }
const BODY: CSSProperties = { margin: 0, fontSize: fs(1.05, 1.55, 1.6), fontWeight: 500 }

function Kick({ tone, children }: { tone?: "ink" | "muted"; children: ReactNode }) {
  return (
    <p className={cx("sb-kicker", tone && `sb-kicker--${tone}`)} style={{ fontSize: fs(0.78, 1.15, 1.2) }}>
      {children}
    </p>
  )
}

// ─── the frame every big-screen page shares ──────────────────────────────────

interface FrameInfo {
  code: string
  /** Sound has been unlocked by a tap. */
  sound: boolean
}

function Frame({
  info,
  tone = "black",
  team,
  flash,
  children,
}: {
  info: FrameInfo
  tone?: "black" | "team"
  team?: number | null
  flash?: string | null
  children: ReactNode
}) {
  return (
    <Page tone={tone} team={team} flash={flash}>
      <header className="sb-topbar">
        <span className="sb-topbar-code">
          <small>Salad Bowl</small>
          {info.code}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {!info.sound && (
            <span className="sb-label sb-label--yellow sb-pulse" style={{ whiteSpace: "normal", textAlign: "center" }}>
              Tap once for sound
            </span>
          )}
          <MuteButton />
        </div>
      </header>
      {children}
    </Page>
  )
}

function Notice({ kicker, title, body, link }: { kicker: string; title: string; body: string; link?: boolean }) {
  return (
    <Page>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, maxWidth: 640, margin: "0 auto", width: "100%" }}>
        <div>
          <Kick>{kicker}</Kick>
          <Display variant="glow" size={fs(2.6, 6, 5)}>
            {title}
          </Display>
        </div>
        <Card tape tilt="l">
          <p style={BODY}>{body}</p>
        </Card>
        {link && (
          <Link className="sb-btn" href={withProfile("/saladbowl")}>
            Back to the front door
          </Link>
        )}
      </div>
    </Page>
  )
}

export function TvScreen({ code }: { code: string }) {
  const { snap } = useGame(code, true)
  const view = useView()
  const [sound, setSound] = useState(false)

  // Browsers only allow sound after a tap (or a key press): unlock on the
  // first one, anywhere, so the buzzer and fanfares can play here too.
  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      setSound(true)
    }
    // A finger's pointerdown is not a user activation (it may become a scroll); the lift is.
    const events = ["pointerup", "touchend", "click", "keydown"] as const
    events.forEach((t) => window.addEventListener(t, unlock, true))
    return () => events.forEach((t) => window.removeEventListener(t, unlock, true))
  }, [])

  const state = snap.state
  const info: FrameInfo = { code, sound }
  let screen
  if (snap.phase === "missing") {
    screen = (
      <Notice
        kicker="No show tonight"
        title="Can't find that game"
        body={`There's no game with the code ${code}. Codes are four letters, and games pack up two days after they go quiet.`}
        link
      />
    )
  } else if (snap.phase === "not_installed") {
    screen = (
      <Notice
        kicker="Soundcheck"
        title="Not switched on yet"
        body="Salad Bowl is built but its database step hasn't been run yet. Once that's done, this screen comes alive."
      />
    )
  } else if (!state) {
    screen = (
      <Page>
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner label="Warming up the big screen" />
        </div>
      </Page>
    )
  } else if (state.status === "lobby") {
    screen = <TvLobby state={state} view={view} info={info} />
  } else if (state.status === "playing" && state.turn) {
    screen = <TvPlaying state={state} turn={state.turn} offset={snap.offset} view={view} info={info} />
  } else if (state.status === "playing") {
    screen = (
      <Frame info={info}>
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner label="Setting the stage" />
        </div>
      </Frame>
    )
  } else {
    screen = <TvFinished state={state} view={view} info={info} />
  }

  return (
    <div className="sb-tv">
      {screen}
      {!snap.online && state && (
        <div
          role="status"
          className="sb-cond"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 70,
            padding: "8px 14px max(8px, env(safe-area-inset-bottom))",
            background: "var(--sb-red)",
            color: "#fff",
            textAlign: "center",
          }}
        >
          Lost the signal. Reconnecting…
        </div>
      )}
      <Toasts />
    </div>
  )
}

// ─── lobby: the join poster ──────────────────────────────────────────────────

function TvLobby({ state, view, info }: { state: GameState; view: View; info: FrameInfo }) {
  const url = joinUrl(state.code)
  const site = url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
  const need = state.settings.wordsPerPlayer
  const qr = view.wide ? between(300, Math.min(view.w * 0.27, view.h * 0.46), 560) : between(220, view.w - 40, 340)
  const done = state.players.filter((p) => p.words >= need).length
  const groups = state.teams.map((t, i) => ({ team: i as number | null, name: t.name, players: state.players.filter((p) => p.team === i) }))
  const loose = state.players.filter((p) => p.team == null || !state.teams[p.team])
  if (loose.length) groups.push({ team: null, name: "No team yet", players: loose })
  const theme = state.settings.theme.trim()
  const noProperNouns = state.settings.noProperNouns === true

  return (
    <Frame info={info}>
      <div style={COLUMNS}>
        <div style={{ ...STACK, alignItems: "center", textAlign: "center" }}>
          <Kick>Scan to join</Kick>
          <QrCode value={url} size={qr} />
          <div>
            <Kick tone="muted">or type the game code</Kick>
            <Display
              as="div"
              size={fs(4.6, 11, 10)}
              style={{ color: "var(--sb-yellow)", letterSpacing: "0.14em", paddingLeft: "0.14em", textShadow: "0.045em 0.045em 0 var(--sb-pink)" }}
            >
              {state.code}
            </Display>
            <p className="sb-cond" style={{ margin: "6px 0 0", fontSize: fs(1.1, 2, 2), textTransform: "none", letterSpacing: "0.02em", overflowWrap: "anywhere" }}>
              Join at <b>{site}/saladbowl</b>
            </p>
          </div>
        </div>

        <div style={STACK}>
          <div>
            <Kick>Soundcheck</Kick>
            <Display variant="glow" size={fs(2.8, 5.6, 5.2)}>
              Join the show
            </Display>
          </div>
          {(!view.wide || view.h >= 800) && <p style={BODY}>Everyone plays on their own phone. Scan the code, type your name, then write your words.</p>}

          <Card tape bar="yellow" style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
              <div style={{ minWidth: 0 }}>
                <Kick tone="ink">{"Tonight's theme"}</Kick>
                <Display as="h2" size={fs(1.9, 3.4, 3.4)} style={{ margin: "4px 0 8px" }}>
                  {theme || (noProperNouns ? "Any everyday thing" : "Anything goes")}
                </Display>
                <p className="sb-cond" style={{ margin: 0, fontSize: fs(0.95, 1.4, 1.4) }}>
                  {plural(need, "word")} each
                </p>
              </div>
              <TempoBadge
                value={state.bowl.total}
                top="In the bowl"
                bottom={state.bowl.total === 1 ? "Word" : "Words"}
                size={view.wide ? between(104, Math.min(view.w * 0.11, view.h * 0.16), 190) : 112}
                ring="var(--sb-yellow)"
              />
            </div>
            {(state.settings.letter || noProperNouns) && (
              <p style={{ margin: "12px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
                {state.settings.letter && (
                  <span className="sb-label sb-label--yellow" style={{ whiteSpace: "normal", fontSize: fs(0.78, 1.2, 1.2) }}>
                    Every word starts with {state.settings.letter}
                  </span>
                )}
                {noProperNouns && (
                  <span className="sb-label sb-label--yellow" style={{ whiteSpace: "normal", fontSize: fs(0.78, 1.2, 1.2) }}>
                    No proper nouns: everyday things only
                  </span>
                )}
              </p>
            )}
          </Card>

          <Liner label={`The crowd: ${state.players.length} in`}>
            {state.players.length === 0 ? (
              <p style={BODY}>
                <Marker tone="yellow">nobody yet. be the first.</Marker>
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {groups
                  .filter((g) => g.players.length > 0)
                  .map((g) => (
                    <div key={g.team ?? "none"} data-team={g.team ?? undefined}>
                      <p className="sb-cond" style={{ margin: "0 0 6px", display: "flex", alignItems: "center", gap: 7, fontSize: fs(0.86, 1.2, 1.25) }}>
                        {g.team != null && <TeamDot team={g.team} />}
                        {g.name}
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {g.players.map((p) => {
                          const ready = p.words >= need
                          return (
                            <span
                              key={p.id}
                              className={cx("sb-chip", "sb-pop", g.team != null && "sb-chip--team", !p.online && "sb-chip--off")}
                              style={{ fontSize: fs(1, 1.45, 1.5) }}
                            >
                              <span>{p.name}</span>
                              {ready ? (
                                <Check size={view.wide ? 24 : 18} strokeWidth={3.5} aria-label="words done" />
                              ) : (
                                <small style={{ opacity: 0.7, fontSize: "0.72em" }}>
                                  {p.words}/{need}
                                </small>
                              )}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                <p className="sb-cond sb-muted" style={{ margin: 0, fontSize: fs(0.86, 1.2, 1.25) }}>
                  {done} of {state.players.length} have written all their words. A tick means done.
                </p>
              </div>
            )}
          </Liner>
        </div>
      </div>
    </Frame>
  )
}

// ─── playing ─────────────────────────────────────────────────────────────────

/** The clock as a very large badge. */
function TvClock({ turn, offset, turnSeconds, size }: { turn: Turn; offset: number; turnSeconds: number; size: number }) {
  const left = useCountdown(turn.state === "active" ? turn.endsAt : null, offset)
  if (turn.state === "paused") {
    return (
      <div style={{ position: "relative", flex: "none" }}>
        <TempoBadge value={clock(turn.remainingMs ?? 0)} top="Time left" size={size} />
        <span
          style={{ position: "absolute", left: "50%", bottom: "9%", transform: `translateX(-50%) scale(${(size / 170).toFixed(2)})`, transformOrigin: "50% 100%" }}
        >
          <Stamp tone="yellow">Paused</Stamp>
        </span>
      </div>
    )
  }
  if (turn.state === "active") {
    const urgent = left <= 10000
    return (
      <TempoBadge
        value={urgent ? Math.ceil(left / 1000) : clock(left)}
        top="Time left"
        bottom={urgent ? "Seconds" : undefined}
        size={size}
        urgent={urgent}
      />
    )
  }
  return (
    <TempoBadge
      value={clock(turn.remainingMs ?? turnSeconds * 1000)}
      top="Get ready"
      bottom={turn.remainingMs != null ? "Carried over" : "On the clock"}
      size={size}
    />
  )
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="sb-display" style={{ fontSize: fs(2.6, 4.8, 4.8) }}>
        {value}
      </div>
      <div className="sb-cond" style={{ fontSize: fs(0.8, 1.15, 1.2), opacity: 0.72, marginTop: 4 }}>
        {label}
      </div>
    </div>
  )
}

function TvPlaying({ state, turn, offset, view, info }: { state: GameState; turn: Turn; offset: number; view: View; info: FrameInfo }) {
  const round = state.round
  const rule = ROUNDS[round.type]
  const team = state.teams[turn.team]
  const teamName = team?.name ?? "their team"
  const giver = state.players.find((p) => p.id === turn.playerId)?.name ?? "Someone"
  const deck = state.onDeck
  const deckPlayer = deck ? state.players.find((p) => p.id === deck.playerId) : null
  const deckTeam = deck ? state.teams[deck.team] : null
  const setLabel = `Set ${round.index + 1} of ${round.count}`

  // ── between sets: the scoreboard is the star ──
  if (turn.state === "round_end") {
    const nextType = state.settings.rounds[round.index + 1]
    const next = nextType ? ROUNDS[nextType] : null
    return (
      <Frame info={info}>
        <div style={COLUMNS}>
          <div style={STACK}>
            <div>
              <Label tone="yellow">{setLabel}</Label>
            </div>
            <Display variant="glow" size={fs(3.4, 8, 8)} className="sb-pop">
              Set {round.index + 1} done
            </Display>
            <p style={BODY}>
              <Marker tone="yellow">{next ? "every word goes back in the bowl" : "that's the whole show"}</Marker>
            </p>
            {next ? (
              <Card tape bar="yellow" tilt="l" style={{ marginTop: 10 }}>
                <Kick tone="ink">Next up: Set {round.index + 2}</Kick>
                <Display as="h2" size={fs(2.2, 4.4, 4.4)} style={{ margin: "4px 0 8px" }}>
                  {next.name}
                </Display>
                <p style={{ ...BODY, fontWeight: 600 }}>{next.rule}</p>
                <p style={{ ...BODY, fontSize: fs(0.95, 1.25, 1.3), marginTop: 6, opacity: 0.8 }}>{next.detail}</p>
                {deckPlayer && deck && (
                  <p
                    className="sb-cond"
                    style={{ margin: "12px 0 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fs(1, 1.5, 1.5) }}
                    data-team={deck.team}
                  >
                    <TeamDot team={deck.team} />
                    {deckPlayer.name} opens for {deckTeam?.name ?? "their team"}
                    {turn.carryNext && turn.leftoverMs ? `, with ${clock(turn.leftoverMs)} left over` : ""}
                  </p>
                )}
              </Card>
            ) : (
              <Card tape tilt="l" style={{ marginTop: 10 }}>
                <Display as="h2" size={fs(2, 3.8, 3.8)}>
                  That was the last set
                </Display>
                <p style={{ ...BODY, marginTop: 8 }}>Final scores are on the way.</p>
              </Card>
            )}
          </div>
          <div style={STACK}>
            <Kick tone="muted">Scores after set {round.index + 1}</Kick>
            <Scoreboard state={state} size="lg" round={round.index} />
          </div>
        </div>
      </Frame>
    )
  }

  const onDeck = deckPlayer && deck && (
    <Liner label={turn.state === "review" ? "Next up" : "On deck"}>
      <p
        className="sb-cond"
        style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fs(1.05, 1.7, 1.7) }}
        data-team={deck.team}
      >
        <TeamDot team={deck.team} />
        {deckPlayer.name}
        <span style={{ opacity: 0.65 }}>for {deckTeam?.name ?? "their team"}</span>
      </p>
    </Liner>
  )

  // ── turn over: what they got ──
  if (turn.state === "review") {
    const won = turn.words.filter((w) => w.got)
    const headline = turn.reason === "bowl" ? "Bowl's empty!" : turn.reason === "host" ? "Turn stopped" : "Time!"
    return (
      <Frame info={info} tone="team" team={turn.team}>
        <div style={COLUMNS}>
          <div style={STACK}>
            <div>
              <Label>{setLabel}</Label>
            </div>
            <Display variant="pop-soft" size={fs(3.6, 9, 9)} className="sb-pop">
              {headline}
            </Display>
            <Display as="p" size={fs(2, 4.6, 4.6)}>
              +{won.length} for {teamName}
            </Display>
            <Card tape style={{ marginTop: 10 }}>
              <Kick tone="ink">{giver} got them to say</Kick>
              {won.length === 0 ? (
                <p style={{ ...BODY, marginTop: 8 }}>
                  <Marker>nothing this time. shake it off.</Marker>
                </p>
              ) : (
                <div key={`${round.index}:${turn.no}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {won.map((w, i) => (
                    <span key={w.id} className="sb-chip sb-chip--soft sb-rise" style={{ fontSize: fs(1.05, 1.8, 1.9), animationDelay: `${0.5 + i * 0.32}s` }}>
                      <span>{w.text}</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
            <p style={BODY}>{giver} is checking the tally on their phone.</p>
          </div>
          <div style={STACK}>
            <Scoreboard state={state} size="lg" activeTeam={turn.team} />
            {onDeck}
          </div>
        </div>
      </Frame>
    )
  }

  // ── ready / on the clock / paused ──
  // The clock shares one of the two columns (COLUMNS inside the 1280px TV wrap) with the name: size it from that column, not the screen.
  const column = (Math.min(view.w - 32, 1280) - between(20, view.w * 0.032, 56)) / 2
  const badge = view.wide ? between(200, Math.min(column * 0.42, view.h * 0.4), 420) : between(132, view.w * 0.4, 190)
  const longest = giver.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0)
  const giverSize = longest <= 9 ? fs(2.1, 4.6, 4.6) : longest <= 13 ? fs(1.8, 3.2, 3.2) : fs(1.4, 2.2, 2.2)
  const line =
    turn.state === "ready"
      ? `Hit START on your phone when ${teamName} is ready.`
      : turn.state === "paused"
        ? "The host paused the clock. Hold that thought."
        : `Giving clues to ${teamName}. Shout it out!`
  return (
    <Frame info={info} tone="team" team={turn.team} flash={turn.state === "ready" ? `${round.index}:${turn.no}` : null}>
      <div style={COLUMNS}>
        <div style={STACK}>
          <div>
            <Label>{setLabel}</Label>
          </div>
          <div>
            <Display variant="pop-soft" size={fs(2.5, 5.2, 5)}>
              {rule?.name ?? "Next set"}
            </Display>
            {rule && <p style={{ ...BODY, fontWeight: 600, marginTop: 8 }}>{rule.rule}</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px, 2vw, 28px)" }}>
            <TvClock turn={turn} offset={offset} turnSeconds={state.settings.turnSeconds} size={badge} />
            <div style={{ minWidth: 0 }}>
              <Kick tone="ink">{turn.state === "ready" ? "You're up" : turn.state === "paused" ? "Paused" : "On the mic"}</Kick>
              <Display as="h2" size={giverSize} className={turn.state === "ready" ? "sb-pop" : undefined} style={{ margin: "4px 0 8px" }}>
                {giver}
              </Display>
              <p style={BODY}>{line}</p>
            </div>
          </div>
          <Card tape style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 16 }}>
              <Stat value={turn.got} label="Words this turn" />
              <Stat value={state.bowl.left} label="Left in the bowl" />
            </div>
          </Card>
        </div>
        <div style={STACK}>
          <Scoreboard state={state} size="lg" activeTeam={turn.team} />
          {onDeck}
        </div>
      </div>
    </Frame>
  )
}

// ─── finished ────────────────────────────────────────────────────────────────

function TvFinished({ state, view, info }: { state: GameState; view: View; info: FrameInfo }) {
  const facts = finaleFacts(state)
  const solo = facts.winners.length === 1 ? facts.winners[0] : null
  const hardest = facts.words.find((w) => w.hardest) ?? null
  const points = facts.topScore === 1 ? "Point" : "Points"
  const badge = view.wide ? between(150, view.w * 0.13, 230) : 112
  const nameSize = (name: string) => (name.length <= 10 ? fs(3.4, 9, 9) : name.length <= 16 ? fs(2.8, 7, 7) : fs(2.3, 5.4, 5.4))

  return (
    <Frame info={info} tone={solo ? "team" : "black"} team={solo?.index}>
      <Confetti pieces={110} />
      <div style={{ ...COLUMNS, flex: "none" }}>
        {solo ? (
          <div style={STACK} className="sb-pop">
            <div>
              <Label>{"That's a wrap"}</Label>
            </div>
            <Display variant="pop-soft" size={nameSize(solo.name)}>
              {solo.name}
            </Display>
            <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px, 2vw, 28px)", flexWrap: "wrap" }}>
              <Display as="p" size={fs(2, 4.6, 4.6)}>
                wins the night
              </Display>
              <div style={{ transform: "rotate(8deg)", flex: "none" }}>
                <TempoBadge value={solo.score} top="Final" bottom={points} size={badge} />
              </div>
            </div>
          </div>
        ) : (
          <div style={STACK} className="sb-pop">
            <div>
              <Label tone="yellow">{"That's a wrap"}</Label>
            </div>
            <Display variant="glow" size={fs(3.4, 9, 9)}>
              {"It's a tie"}
            </Display>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {facts.winners.map((t, i) => (
                <div key={t.index} data-team={t.index}>
                  {i > 0 && <Kick tone="muted">and</Kick>}
                  <Display as="p" size={fs(2.2, 5, 5)} style={{ color: "var(--sb-team)" }}>
                    {t.name}
                  </Display>
                </div>
              ))}
            </div>
            <Display as="p" size={fs(1.6, 3.4, 3.4)}>
              share the night, tied at {plural(facts.topScore, "point")}
            </Display>
          </div>
        )}
        <div style={STACK}>
          <Kick tone={solo ? "ink" : "muted"}>Final score</Kick>
          <Scoreboard state={state} size="lg" />
        </div>
      </div>

      {(facts.awards.length > 0 || hardest) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
            gap: "clamp(20px, 2.4vw, 34px)",
            marginTop: 22,
          }}
        >
          {facts.awards.map((a, i) => (
            <Card key={a.key} tape bar={a.bar} tilt={i % 2 ? "r" : "l"} className="sb-rise" style={{ animationDelay: `${0.6 + i * 0.25}s` }}>
              <Kick tone="ink">{a.title}</Kick>
              <Display as="h3" size={fs(1.8, 2.9, 3)} style={{ margin: "4px 0 8px" }}>
                {a.headline}
              </Display>
              <p style={{ ...BODY, fontSize: fs(0.95, 1.25, 1.3) }}>{a.detail}</p>
            </Card>
          ))}
          {hardest && (
            <Card tape bar="pink" tilt={facts.awards.length % 2 ? "r" : "l"} className="sb-rise" style={{ animationDelay: `${0.6 + facts.awards.length * 0.25}s` }}>
              <Kick tone="ink">Hardest word</Kick>
              <Display as="h3" size={fs(1.8, 2.9, 3)} style={{ margin: "4px 0 8px" }}>
                {hardest.text}
              </Display>
              <p style={{ ...BODY, fontSize: fs(0.95, 1.25, 1.3) }}>
                Took {clock(hardest.ms)} across the sets
                {hardest.skips > 0 ? `, skipped ${hardest.skips === 1 ? "once" : `${hardest.skips} times`}` : ""}.
              </p>
              <p style={{ margin: "8px 0 0" }}>
                <Marker arrow="left">written by {hardest.author}</Marker>
              </p>
            </Card>
          )}
        </div>
      )}

      <p style={{ ...BODY, textAlign: "center", marginTop: 14 }}>
        Check your phone to see who wrote every word. The host can call an encore from theirs.
      </p>
    </Frame>
  )
}
