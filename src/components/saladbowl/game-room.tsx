"use client"

// Salad Bowl — one game on one phone. Picks the screen for the moment:
// join → lobby → stage (the game) → finale.
import { useEffect } from "react"
import Link from "next/link"

import { withProfile } from "@/lib/saladbowl/seats"
import { unlockAudio } from "@/lib/saladbowl/sound"
import { useGame } from "@/lib/saladbowl/store"

import { Finale } from "./finale"
import { JoinScreen } from "./join"
import { Lobby } from "./lobby"
import { Stage } from "./stage"
import { Card, Display, Kicker, Marker, Page, Spinner, Toasts } from "./ui"

export function GameRoom({ code }: { code: string }) {
  const { store, snap } = useGame(code)

  // Browsers only allow sound after a tap: unlock on the first one, anywhere.
  useEffect(() => {
    const unlock = () => unlockAudio()
    // A finger's pointerdown is not a user activation (it may become a scroll); the lift is.
    const events = ["pointerup", "touchend", "click", "keydown"] as const
    events.forEach((t) => window.addEventListener(t, unlock, true))
    return () => events.forEach((t) => window.removeEventListener(t, unlock, true))
  }, [])

  const state = snap.state

  // A new screen (lobby → your turn → tally → …) starts at the top, not
  // wherever the previous one happened to be scrolled to.
  const screenKey = state ? `${state.status}:${state.turn?.state ?? ""}:${state.turn?.no ?? ""}:${state.round.index}` : snap.phase
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screenKey])

  let screen
  if (snap.phase === "missing") {
    screen = (
      <Notice
        kicker="No show tonight"
        title="Can't find that game"
        body={`There's no game with the code ${code}. Codes are four letters, and games pack up two days after they go quiet.`}
      />
    )
  } else if (snap.phase === "not_installed") {
    screen = (
      <Notice
        kicker="Soundcheck"
        title="Not switched on yet"
        body="Salad Bowl is built but its database step hasn't been run yet. Once that's done, this page comes alive."
      />
    )
  } else if (!state) {
    screen = (
      <Page>
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner label="Tuning up" />
        </div>
      </Page>
    )
  } else if (!snap.seat) {
    screen = <JoinScreen store={store} snap={snap} state={state} />
  } else if (!state.me) {
    // We hold a seat but the last picture was fetched without it: one more beat.
    screen = (
      <Page>
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <Spinner label="Finding your seat" />
        </div>
      </Page>
    )
  } else if (state.status === "lobby") {
    screen = <Lobby store={store} snap={snap} state={state} />
  } else if (state.status === "playing") {
    screen = <Stage store={store} snap={snap} state={state} />
  } else {
    screen = <Finale store={store} snap={snap} state={state} />
  }

  return (
    <>
      {screen}
      {!snap.online && state && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            zIndex: 70,
            padding: "max(8px, env(safe-area-inset-top)) 14px 8px",
            background: "var(--sb-red)",
            color: "#fff",
            textAlign: "center",
          }}
          className="sb-cond"
        >
          Lost the signal. Reconnecting…
        </div>
      )}
      <Toasts />
    </>
  )
}

function Notice({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <Page>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
        <div>
          <Kicker>{kicker}</Kicker>
          <Display variant="glow" size="clamp(2.6rem, 13vw, 4.4rem)">
            {title}
          </Display>
        </div>
        <Card tape tilt="l">
          <p style={{ margin: 0 }}>{body}</p>
          <p style={{ margin: "10px 0 0" }}>
            <Marker arrow="left">start a fresh one instead</Marker>
          </p>
        </Card>
        <Link className="sb-btn" href={withProfile("/saladbowl")}>
          Back to the front door
        </Link>
      </div>
    </Page>
  )
}
