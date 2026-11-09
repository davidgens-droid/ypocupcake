"use client"

// Salad Bowl — the game itself, as one phone sees it. Every phone shows the
// same turn from its own seat: the clue-giver gets the word and the big
// buttons, their team gets told to shout, everyone else watches the clock.
//
//   ready → active (⇄ paused) → review → ready … → round_end → ready …
//
// The tally check and set break live in stage-after.tsx, the host's controls
// in stage-host.tsx.
import { useEffect, useRef, useState } from "react"
import { Settings } from "lucide-react"

import { ROUNDS, clock } from "@/lib/saladbowl/content"
import { buzz, sfx } from "@/lib/saladbowl/sound"
import { useCountdown } from "@/lib/saladbowl/store"

import type { ScreenProps } from "./props"
import { TopBar } from "./room-bar"
import { Scoreboard } from "./scoreboard"
import { ReviewView, RoundEndView } from "./stage-after"
import { HostSheet } from "./stage-host"
import { Dock, attempt, fitText, playerById, plural, teamName, wordSize, type StageProps } from "./stage-util"
import { Button, Card, Display, Kicker, Label, Liner, Page, Spinner, TeamDot, TempoBadge, cx } from "./ui"

export function Stage({ store, snap, state }: ScreenProps) {
  const [hostOpen, setHostOpen] = useState(false)
  const turn = state.turn
  const me = state.me

  if (!turn || !me) {
    return (
      <Page>
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner label="Tuning up" />
        </div>
      </Page>
    )
  }

  const giver = playerById(state, turn.playerId)
  const isGiver = me.id === turn.playerId
  const view: StageProps = {
    store,
    snap,
    state,
    turn,
    me,
    giver,
    giverName: giver?.name ?? "Someone",
    isGiver,
    isTeammate: !isGiver && me.team != null && me.team === turn.team,
    host: me.host,
  }

  // The stage goes dark when the clock is stopped and between sets; otherwise
  // the whole page is the colour of the team that is on.
  const dark = turn.state === "paused" || turn.state === "round_end"
  const round = ROUNDS[state.round.type]

  let screen
  if (turn.state === "ready") screen = isGiver ? <ReadyGiver {...view} /> : <ReadyCrowd {...view} />
  else if (turn.state === "active")
    screen = isGiver ? <ActiveGiver key={turn.no} {...view} /> : <ActiveCrowd {...view} />
  else if (turn.state === "paused") screen = <PausedView {...view} />
  else if (turn.state === "review") screen = <ReviewView key={turn.no} {...view} />
  else screen = <RoundEndView {...view} />

  return (
    <Page
      tone={dark ? "black" : "team"}
      team={turn.team}
      flash={isGiver && turn.state === "ready" ? turn.since : null}
    >
      <TopBar
        store={store}
        snap={snap}
        state={state}
        extra={
          me.host ? (
            <button type="button" className="sb-iconbtn" aria-label="Host controls" onClick={() => setHostOpen(true)}>
              <Settings size={22} />
            </button>
          ) : undefined
        }
        hostShortcut={
          me.host
            ? { label: "Host controls", note: "Pause, end a turn, fix a score, move players or change the timer.", onClick: () => setHostOpen(true) }
            : undefined
        }
      />

      {/* Where we are in the show: set, rule, bowl, scores. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Label tone={dark ? "yellow" : undefined}>
            Set {state.round.index + 1} of {state.round.count}
          </Label>
          <span
            className="sb-cond"
            style={{ flex: 1, minWidth: 0, fontSize: "0.92rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {round.name}
          </span>
          <span className="sb-cond" style={{ flex: "none", fontSize: "0.92rem" }}>
            {state.bowl.left === 0 ? "Bowl empty" : `${state.bowl.left} left in bowl`}
          </span>
        </div>
        {/* On a short phone the clue-giver needs the room for the word and the buttons. */}
        <div className={isGiver && turn.state === "active" ? "[@media(max-height:700px)]:hidden" : undefined}>
          <Scoreboard state={state} size="sm" activeTeam={turn.state === "round_end" ? null : turn.team} />
        </div>
      </div>

      {screen}

      {me.host && <HostSheet store={store} snap={snap} state={state} open={hostOpen} onClose={() => setHostOpen(false)} />}
    </Page>
  )
}

// ─── ready: waiting for the clue-giver to hit START ──────────────────────────

function ReadyGiver({ store, snap, state, turn, me }: StageProps) {
  const round = ROUNDS[state.round.type]
  const carried = turn.remainingMs != null
  const ms = turn.remainingMs ?? state.settings.turnSeconds * 1000
  const secs = Math.ceil(ms / 1000)

  return (
    <>
      <div className="sb-pop">
        <Kicker tone="ink">Headlining for {teamName(state, turn.team)}</Kicker>
        <Display variant="pop-soft" size="clamp(3.2rem, 18vw, 5.6rem)">
          You&apos;re up,
        </Display>
        <Display as="div" variant="pop-soft" size={fitText(me.name, 5.6, 2)}>
          {me.name}
        </Display>
      </div>

      {/* The rule on taped paper, with the clock sealed onto its corner. */}
      <Card tape tilt="l" style={{ marginTop: 8 }}>
        <div style={{ position: "absolute", top: -22, right: -8 }}>
          <TempoBadge
            value={secs >= 100 ? clock(ms) : secs}
            top="Your clock"
            bottom={secs >= 100 ? "minutes" : plural(secs, "second")}
            size={96}
          />
        </div>
        <div style={{ paddingRight: 84 }}>
          <Kicker tone="ink">
            Set {state.round.index + 1}: the rule
          </Kicker>
          <h2 className="sb-card-title" style={{ fontSize: "2rem", margin: "6px 0 10px" }}>
            {round.name}
          </h2>
        </div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: "1.12rem" }}>{round.rule}</p>
        <p className="sb-muted" style={{ margin: "6px 0 0", fontSize: "0.95rem" }}>
          {round.detail}
        </p>
      </Card>

      <div>
        <p className="sb-cond" style={{ margin: 0, fontSize: "1.08rem" }}>
          {carried
            ? `You kept ${clock(ms)} from emptying the bowl last set. That is your clock this turn.`
            : `You get ${secs} seconds. The clock starts when you tap START.`}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: "1rem" }}>
          Keep the screen to yourself. Tap GOT IT every time your team guesses a word.
        </p>
      </div>

      <Dock reserve={142}>
        <Button
          size="xl"
          className="sb-pulse"
          style={{ minHeight: 104 }}
          disabled={snap.pending === "turn:start"}
          onClick={() => attempt(store.startTurn())}
        >
          Start
        </Button>
      </Dock>
    </>
  )
}

function ReadyCrowd({ store, snap, state, turn, me, giver, giverName, isTeammate, host }: StageProps) {
  const round = ROUNDS[state.round.type]
  const onDeck = state.onDeck?.playerId === me.id
  const asleep = !!giver && !giver.online
  const ms = turn.remainingMs ?? state.settings.turnSeconds * 1000

  return (
    <>
      <div className="sb-rise">
        <Kicker tone="ink">Up next</Kicker>
        <Display variant="pop-soft" size={fitText(giverName, 5.6, 2)}>
          {giverName}
        </Display>
        <p className="sb-cond" style={{ margin: "8px 0 0", fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
          <TeamDot team={turn.team} />
          for {teamName(state, turn.team)}
        </p>
      </div>

      <Display as="p" size="clamp(1.7rem, 8.4vw, 2.5rem)">
        {isTeammate ? "Your team is guessing. Get ready to shout." : "You're watching. Keep them honest."}
      </Display>

      {onDeck && (
        <Liner label="Heads up">
          <Display as="p" size="2rem" style={{ color: "var(--sb-yellow)" }}>
            You&apos;re on deck
          </Display>
          <p style={{ margin: "6px 0 0" }}>You go right after this turn. Stay close to your phone.</p>
        </Liner>
      )}

      <Card tape tilt="r">
        <Kicker tone="ink">
          Set {state.round.index + 1}: {round.name}
        </Kicker>
        <p style={{ margin: "6px 0 0", fontWeight: 600, fontSize: "1.08rem" }}>{round.rule}</p>
        <p className="sb-muted" style={{ margin: "8px 0 0", fontSize: "0.95rem" }}>
          {turn.remainingMs != null
            ? `${giverName} kept ${clock(ms)} from emptying the bowl last set.`
            : `${Math.ceil(ms / 1000)} seconds on the clock.`}{" "}
          It starts when {giverName} taps START.
        </p>
      </Card>

      {asleep && (
        <Liner label="Wake-up call">
          <p style={{ margin: 0, fontSize: "1.05rem" }}>
            {giverName}&apos;s phone looks asleep. Give them a nudge.
          </p>
          {host && (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="paper"
                disabled={snap.pending === "host:skip_player"}
                onClick={() => attempt(store.host("skip_player"))}
              >
                Skip to the next player
              </Button>
            </div>
          )}
        </Liner>
      )}
    </>
  )
}

// ─── active: the clock is running ────────────────────────────────────────────

/** One tick per second for the last five seconds (sound only; no state). */
function useFinalTicks(secs: number) {
  useEffect(() => {
    if (secs >= 1 && secs <= 5) sfx.tick()
  }, [secs])
}

function ActiveGiver({ store, snap, state, turn }: StageProps) {
  // The tap being sent right now, so the card answers the thumb instantly.
  const [sent, setSent] = useState<{ id: string; kind: "got" | "skip" } | null>(null)
  const left = useCountdown(turn.endsAt, snap.offset)
  const secs = Math.ceil(left / 1000)
  useFinalTicks(secs)

  const round = ROUNDS[state.round.type]
  const word = turn.word
  const over = left <= 0 || !word
  const busy = !!word && sent?.id === word.id
  const skipRule = state.settings.skipRule

  // When the last tap's answer put a new word on the card: the second half of
  // a double tap must not count against a word nobody has read yet.
  const swappedAt = useRef(0)

  async function got() {
    if (!word || over || busy || Date.now() - swappedAt.current < 400) return
    setSent({ id: word.id, kind: "got" })
    buzz(30)
    await attempt(store.correct())
    swappedAt.current = Date.now()
    setSent(null)
  }
  async function skip() {
    if (!word || over || busy || Date.now() - swappedAt.current < 400) return
    setSent({ id: word.id, kind: "skip" })
    await attempt(store.skip())
    swappedAt.current = Date.now()
    setSent(null)
  }
  async function undo() {
    setSent(null)
    await attempt(store.undo())
  }

  const cardLayout = { flex: "1 1 auto", minHeight: "min(24dvh, 220px)" }

  return (
    <div className="sb-giver" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Count on the left; the clock is sealed onto the corner of the word
          card, like the tempo badge on a show page. */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: -30,
          paddingRight: 2,
          position: "relative",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <div key={turn.got} className="sb-pop" style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 36 }}>
          <Display as="span" size="2.7rem">
            {turn.got}
          </Display>
          <Kicker tone="ink">this turn</Kicker>
        </div>
        <TempoBadge value={secs} top="Time left" bottom={plural(secs, "second")} size={88} urgent={!over && secs <= 10} />
      </div>

      {over || !word ? (
        <div key="time" className="sb-word sb-word--in" style={cardLayout} role="status">
          <div>
            <Display as="div" size="clamp(4rem, 24vw, 7rem)" variant="pop">
              Time!
            </Display>
            <p className="sb-cond" style={{ margin: "10px 0 0" }}>
              Hands off. The tally check is next.
            </p>
          </div>
        </div>
      ) : (
        <div key={word.id} className="sb-word sb-word--in" style={cardLayout} aria-live="polite">
          <Display as="div" size={wordSize(word.text)} style={{ opacity: busy ? 0.22 : 1, maxWidth: "100%", minWidth: 0 }}>
            {word.text}
          </Display>
          {busy && sent && (
            <span
              className={cx("sb-stamp", sent.kind === "got" ? "sb-stamp--green" : "sb-stamp--ink", "sb-pop")}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: "6em",
                margin: "-0.8em 0 0 -3em",
                fontSize: "1.7rem",
                background: "var(--sb-paper)",
              }}
              aria-hidden
            >
              {sent.kind === "got" ? "Got it" : "Skipped"}
            </span>
          )}
        </div>
      )}

      <p className="sb-cond [@media(max-height:600px)]:hidden" style={{ margin: 0, textAlign: "center", fontSize: "0.95rem" }}>
        <span style={{ textTransform: "none", letterSpacing: "0.02em" }}>{round.rule}</span>
      </p>

      {/* Thumb zone. GOT IT is never greyed out mid-tap: a tap while the last
          one is still on its way is simply ignored. SKIP sits well clear of it. */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 24, paddingTop: 2, paddingBottom: 4 }}>
        <Button
          size="xl"
          variant="green"
          style={{ minHeight: "clamp(96px, 16dvh, 124px)" }}
          disabled={over}
          aria-disabled={over || busy}
          onClick={got}
        >
          Got it
        </Button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 58 }}>
          {turn.canSkip ? (
            <Button variant="paper" inline disabled={over} onClick={skip} style={{ paddingInline: 26 }}>
              Skip{skipRule === "one" ? " (1 left)" : ""}
            </Button>
          ) : skipRule !== "none" ? (
            <Button variant="paper" inline disabled style={{ paddingInline: 20 }}>
              No skips left
            </Button>
          ) : (
            <span className="sb-cond" style={{ fontSize: "0.86rem", opacity: 0.75 }}>
              No skipping tonight
            </span>
          )}
          {turn.got > 0 && (
            <button
              type="button"
              className="sb-link"
              style={{ minHeight: 48, padding: "6px 4px" }}
              disabled={over || snap.pending === "turn:undo"}
              onClick={undo}
            >
              Undo last
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ActiveCrowd({ snap, state, turn, giverName, isTeammate }: StageProps) {
  const left = useCountdown(turn.endsAt, snap.offset)
  const secs = Math.ceil(left / 1000)
  useFinalTicks(secs)
  const round = ROUNDS[state.round.type]
  const over = left <= 0
  const headline = over ? "Time!" : `${giverName} is up`

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-evenly", gap: 16, textAlign: "center" }}>
      <TempoBadge value={secs} top="Time left" bottom={plural(secs, "second")} size={212} urgent={secs <= 10} />

      <div>
        <Display variant="pop-soft" size={fitText(headline, 4.4, 1.9)}>
          {headline}
        </Display>
        <p className="sb-cond" style={{ margin: "8px 0 0", fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <TeamDot team={turn.team} />
          for {teamName(state, turn.team)}
        </p>
      </div>

      <div key={turn.got} className="sb-pop">
        <Display as="div" size="4.6rem">
          {turn.got}
        </Display>
        <Kicker tone="ink">{plural(turn.got, "word")} this turn</Kicker>
      </div>

      <Display as="p" size="clamp(2.2rem, 11vw, 3.2rem)" variant={isTeammate ? "pop-soft" : undefined}>
        {isTeammate ? "Shout it out!" : "Shh. Not your turn."}
      </Display>

      <p className="sb-cond" style={{ margin: 0, fontSize: "0.98rem" }}>
        {round.name}: <span style={{ textTransform: "none", letterSpacing: "0.02em" }}>{round.rule}</span>
      </p>
    </div>
  )
}

// ─── paused: the host stopped the clock ──────────────────────────────────────

function PausedView({ store, snap, state, turn, giverName, isGiver, host }: StageProps) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, textAlign: "center" }}>
      <span className="sb-stamp sb-stamp--yellow sb-pop" style={{ fontSize: "clamp(2.6rem, 15vw, 4rem)", padding: "8px 22px 4px" }}>
        Paused
      </span>

      <TempoBadge value={clock(turn.remainingMs ?? 0)} top="Time left" bottom="on hold" size={176} ring="var(--sb-yellow)" />

      <div>
        <Display as="p" variant="glow" size={fitText(isGiver ? "You were up" : `${giverName} was up`, 3, 1.6)}>
          {isGiver ? "You were up" : `${giverName} was up`}
        </Display>
        <p className="sb-cond" style={{ margin: "8px 0 0", fontSize: "1.05rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <TeamDot team={turn.team} />
          for {teamName(state, turn.team)}
        </p>
      </div>

      <p className="sb-muted" style={{ margin: 0, maxWidth: 340 }}>
        {isGiver
          ? "Your word is hidden while the clock is stopped. You get it back the moment the game resumes."
          : "The clock is stopped and the word is hidden. No guessing until the game resumes."}
      </p>

      {host ? (
        <div style={{ width: "100%", paddingBottom: 10 }}>
          <Button size="xl" variant="green" disabled={snap.pending === "host:resume"} onClick={() => attempt(store.host("resume"))}>
            Resume
          </Button>
        </div>
      ) : (
        <Kicker tone="muted">Waiting for the host to resume</Kicker>
      )}
    </div>
  )
}
