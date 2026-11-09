"use client"

// Salad Bowl — what happens after the buzzer: the tally check ("review") and
// the break between sets ("round_end").
import { useState } from "react"
import { Check, X } from "lucide-react"

import { ROUNDS, clock } from "@/lib/saladbowl/content"
import type { GameState } from "@/lib/saladbowl/types"

import { Scoreboard } from "./scoreboard"
import { After, Dock, attempt, fitText, playerById, plural, teamName, type StageProps } from "./stage-util"
import { Button, Card, Confetti, Display, Kicker, Liner, Marker, Stars, TeamDot } from "./ui"

const HEADLINE = { time: "Time!", bowl: "Bowl's empty!", host: "Turn stopped" } as const
const KICKER = {
  time: "That's the buzzer",
  bowl: "Every word guessed",
  host: "The host stopped the clock",
} as const

// ─── review ──────────────────────────────────────────────────────────────────

export function ReviewView(props: StageProps) {
  const { store, snap, state, turn, me, giverName, isGiver, host } = props
  const [busyId, setBusyId] = useState<string | null>(null)

  const reason = turn.reason ?? "time"
  const team = teamName(state, turn.team)
  const won = isGiver ? turn.words.filter((w) => w.got).length : turn.words.length
  const advancing = snap.pending === "turn:advance"
  const bowlEmpty = state.bowl.left === 0
  const lastSet = state.round.index + 1 >= state.round.count
  const next = playerById(state, state.onDeck?.playerId)
  const nextIsMe = !!next && next.id === me.id

  async function toggle(id: string, got: boolean) {
    if (busyId) return
    setBusyId(id)
    await attempt(store.toggleWord(id, got))
    setBusyId(null)
  }

  const advanceLabel = bowlEmpty ? (lastSet ? "See the final scores" : "Wrap up the set") : "Pass the mic"

  const whatsNext = bowlEmpty ? (
    <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
      {lastSet
        ? "That empties the bowl for the last time. Final scores are next."
        : `That empties the bowl. Set ${state.round.index + 1} is done.`}
    </p>
  ) : next ? (
    <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <TeamDot team={next.team} />
      {nextIsMe ? "You're up next. Get ready." : `Next up: ${next.name} for ${teamName(state, next.team)}`}
    </p>
  ) : null

  const total = (
    <div key={won} className="sb-pop" style={{ textAlign: "center" }}>
      <Display as="div" variant="pop-soft" size={fitText(`+${won} for`, 4.6, 2.4)}>
        +{won} for
      </Display>
      <Display as="div" size={fitText(team, 2.6, 1.3)}>
        {team}
      </Display>
    </div>
  )

  if (isGiver) {
    return (
      <>
        <div className="sb-pop">
          <Kicker tone="ink">{KICKER[reason]}</Kicker>
          <Display variant="pop-soft" size={fitText(HEADLINE[reason], 5.4, 2.6)}>
            {HEADLINE[reason]}
          </Display>
          {reason === "bowl" && !!turn.leftoverMs && turn.leftoverMs >= 1000 && (
            <p className="sb-cond" style={{ margin: "8px 0 0", fontSize: "1.05rem" }}>
              You cleared it with {clock(turn.leftoverMs)} left on the clock.
            </p>
          )}
        </div>

        <Card tape>
          <div className="sb-setlist">
            <div className="sb-setlist-head">
              <span>Check the tally</span>
              <span style={{ fontSize: "0.72rem", letterSpacing: "0.14em" }}>Tap to fix</span>
            </div>
            {turn.words.length === 0 && (
              <p style={{ margin: "12px 0 4px" }}>No words this turn. It happens to the best of us.</p>
            )}
            {turn.words.map((w) => (
              <div key={w.id} className="sb-row">
                <div className="sb-row-grow">
                  {w.buzzer && (
                    <div className="sb-row-key" style={{ marginBottom: 3 }}>
                      On the buzzer: did they get it?
                    </div>
                  )}
                  <div className="sb-row-title" style={{ overflowWrap: "anywhere", opacity: w.got ? 1 : 0.55 }}>
                    {w.text}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={w.got ? "green" : "paper"}
                  aria-pressed={w.got}
                  aria-label={`${w.text}: ${w.got ? "got it. Tap to mark as missed" : "missed. Tap to mark as got"}`}
                  style={{ minWidth: 118, minHeight: 50, flex: "none" }}
                  onClick={() => toggle(w.id, !w.got)}
                >
                  {w.got ? <Check size={20} /> : <X size={20} />}
                  {w.got ? "Got it" : "Missed"}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        {total}

        {whatsNext}

        <Dock>
          <Button disabled={advancing} onClick={() => attempt(store.advance())}>
            Looks right. {advanceLabel}
          </Button>
        </Dock>
      </>
    )
  }

  return (
    <>
      <div className="sb-pop">
        <Kicker tone="ink">{KICKER[reason]}</Kicker>
        <Display variant="pop-soft" size={fitText(HEADLINE[reason], 5.4, 2.6)}>
          {HEADLINE[reason]}
        </Display>
      </div>

      {total}

      <Card tape tilt="r">
        <div className="sb-setlist">
          <div className="sb-setlist-head">
            <span>{giverName}&apos;s haul</span>
            <span>
              {won} {plural(won, "word")}
            </span>
          </div>
          {turn.words.length === 0 && <p style={{ margin: "12px 0 4px" }}>Nothing this time. Tough crowd.</p>}
          {turn.words.map((w, i) => (
            <div key={w.id} className="sb-row sb-rise" style={{ animationDelay: `${Math.min(i, 12) * 0.14}s` }}>
              <div className="sb-row-title sb-row-grow" style={{ overflowWrap: "anywhere" }}>
                {w.text}
              </div>
              {host && (
                <button
                  type="button"
                  className="sb-link"
                  style={{ minHeight: 44, flex: "none" }}
                  aria-label={`Take back ${w.text}`}
                  onClick={() => toggle(w.id, false)}
                >
                  Take back
                </button>
              )}
            </div>
          ))}
        </div>
        {host && turn.words.length > 0 && (
          <p style={{ margin: "10px 0 0", fontSize: "0.9rem" }}>
            Host: take back any word that should not have counted. {giverName} can put it back from their phone.
          </p>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
          {giverName} is checking the tally.
        </p>
        {whatsNext}
      </div>

      {host ? (
        <Dock>
          <Button disabled={advancing} onClick={() => attempt(store.advance())}>
            {advanceLabel}
          </Button>
        </Dock>
      ) : (
        // The server lets anyone move things along once the clue-giver has had 15 seconds.
        <After since={turn.since} offset={snap.offset} ms={15000}>
          <Dock>
            <Button variant="paper" disabled={advancing} onClick={() => attempt(store.advance())}>
              Keep the show moving
            </Button>
          </Dock>
        </After>
      )}
    </>
  )
}

// ─── between sets ────────────────────────────────────────────────────────────

/** "Out front: Kale Halen, by 3" / "All tied up on 7". */
function standing(state: GameState): string {
  const scores = state.teams.map((t) => t.score)
  const top = Math.max(...scores)
  const leaders = state.teams.filter((t) => t.score === top)
  if (leaders.length === state.teams.length) return `All tied up on ${top}`
  if (leaders.length > 1) return `${leaders.map((t) => t.name).join(" and ")} share the lead on ${top}`
  const second = Math.max(...scores.filter((s) => s !== top))
  return `${leaders[0].name} out front by ${top - second}`
}

export function RoundEndView(props: StageProps) {
  const { store, snap, state, turn, me, host, giver, giverName, isGiver } = props
  const setNo = state.round.index + 1
  const nextType = state.settings.rounds[state.round.index + 1]
  const nextRound = nextType ? ROUNDS[nextType] : null
  const opener = playerById(state, state.onDeck?.playerId)
  const opensIsMe = !!opener && opener.id === me.id
  const advancing = snap.pending === "turn:advance"
  const startLabel = nextRound ? `Start set ${setNo + 1}` : "See the final scores"

  const startButton = (
    <Button disabled={advancing} onClick={() => attempt(store.advance())}>
      {startLabel}
    </Button>
  )

  return (
    <>
      <Confetti key={turn.since} pieces={44} />
      <div className="sb-pop" style={{ textAlign: "center" }}>
        <Kicker>The bowl is empty</Kicker>
        <Display variant="glow" size="clamp(3.4rem, 19vw, 6rem)">
          Set {setNo} done
        </Display>
      </div>

      <Scoreboard state={state} round={state.round.index} />

      <p style={{ margin: 0, textAlign: "center" }}>
        <Marker tone="yellow">{standing(state)}</Marker>
      </p>

      <Stars />

      {nextRound ? (
        <Card tape bar="yellow" tilt="l">
          <Kicker tone="ink">
            Next: set {setNo + 1} of {state.round.count}
          </Kicker>
          <h2 className="sb-card-title" style={{ fontSize: "2rem", margin: "6px 0 10px" }}>
            Set {setNo + 1}: {nextRound.name}
          </h2>
          <p style={{ margin: 0, fontWeight: 600, fontSize: "1.1rem" }}>{nextRound.rule}</p>
          <p className="sb-muted" style={{ margin: "6px 0 0", fontSize: "0.95rem" }}>
            {nextRound.detail}
          </p>
          <p style={{ margin: "12px 0 0" }}>
            <Marker tone="blue" arrow="left">
              same words. every one goes back in the bowl
            </Marker>
          </p>
        </Card>
      ) : (
        <Card tape>
          <h2 className="sb-card-title">That was the last set</h2>
          <p style={{ margin: 0 }}>Final scores are next.</p>
        </Card>
      )}

      {nextRound && opener && (
        <Liner label="Opening the set">
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }} className="sb-cond">
            <TeamDot team={opener.team} />
            <span style={{ fontSize: "1.15rem" }}>
              {opensIsMe ? "You open it" : `${opener.name} opens it`} for {teamName(state, opener.team)}
            </span>
          </p>
          {turn.carryNext && (
            <p style={{ margin: "8px 0 0", fontSize: "0.98rem" }}>
              {opensIsMe ? "You" : opener.name} emptied the bowl with {clock(turn.leftoverMs ?? 0)} to spare and{" "}
              {opensIsMe ? "open" : "opens"} the next set with that time.
            </p>
          )}
        </Liner>
      )}

      {host || isGiver ? (
        <Dock>{startButton}</Dock>
      ) : (
        // Anyone may start the next set once the host and the player who emptied the bowl have had 8 seconds.
        <After
          since={turn.since}
          offset={snap.offset}
          ms={8000}
          fallback={
            <p className="sb-cond sb-muted" style={{ margin: 0, textAlign: "center" }}>
              {giver ? `${giverName} or the host starts the next set.` : "The host starts the next set."}
            </p>
          }
        >
          <Dock>{startButton}</Dock>
        </After>
      )}
    </>
  )
}
