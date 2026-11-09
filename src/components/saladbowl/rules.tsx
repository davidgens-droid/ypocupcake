"use client"

// Salad Bowl — how to play, in thirty seconds. Sits on cream paper (a Card on
// the front door, a Sheet in the in-game menu), so everything here is dark ink
// and there are no page-level wrappers.
import type { CSSProperties } from "react"

import { ROUND_ORDER, ROUNDS } from "@/lib/saladbowl/content"

import { Marker } from "./ui"

const STEPS: { title: string; text: string }[] = [
  {
    title: "Fill the bowl",
    text: "Everyone secretly types a few words or names on their own phone. The host picks the theme.",
  },
  {
    title: "Pick teams",
    text: "The host splits the room into teams. Two or more players on each.",
  },
  {
    title: "You're up",
    text: "Your phone flashes and plays a riff when it's your turn (iPhone: ringer on to hear it). Tap START and the clock runs.",
  },
  {
    title: "Give clues",
    text: "A word shows on your phone only. Get your team to say it, tap GOT IT, and the next word appears. One point each.",
  },
  {
    title: "Pass the mic",
    text: "When the buzzer goes, the next team sends a player up. Keep taking turns until the bowl is empty.",
  },
  {
    title: "Go again, harder",
    text: "An empty bowl ends the set. Every word goes back in and the next set has a tougher clue rule. Most points after the last set wins.",
  },
]

const HOUSE_RULES: { key: string; text: string }[] = [
  {
    key: "Skips",
    text: "Stuck? Skipping puts the word back in the bowl for later. The host decides how many skips you get.",
  },
  {
    key: "Buzzer",
    text: "When time runs out you see the words from your turn. Fix any mis-taps, then pass the mic.",
  },
  {
    key: "Clock",
    text: "Empty the bowl with time to spare and you keep those seconds to open the next set.",
  },
]

const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0 }
const rowTop: CSSProperties = { alignItems: "flex-start" }
const small: CSSProperties = { fontSize: "0.95rem", lineHeight: 1.3, marginTop: 3 }
const headNote: CSSProperties = { fontSize: "0.68rem", textAlign: "right", color: "rgba(12, 12, 14, 0.7)" }
const stepNumber: CSSProperties = {
  flex: "none",
  width: 30,
  fontFamily: "var(--sb-display)",
  fontSize: "1.7rem",
  lineHeight: 0.95,
  textAlign: "center",
  textShadow: "0.06em 0.06em 0 var(--sb-pink)",
}
export function HowToPlay() {
  const rounds = ROUND_ORDER.map((type) => ROUNDS[type])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, color: "var(--sb-ink)" }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        Get your team to guess the words in the bowl. Same words every set. The clues get harder.
      </p>

      <div className="sb-setlist">
        <div className="sb-setlist-head">
          <span>The night</span>
          <span style={headNote}>Most points wins</span>
        </div>
        <ol style={list}>
          {STEPS.map((step, i) => (
            <li key={step.title} className="sb-row" style={rowTop}>
              <span style={stepNumber}>{i + 1}</span>
              <div className="sb-row-grow">
                <div className="sb-row-title">{step.title}</div>
                <div style={small}>{step.text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="sb-setlist">
        <div className="sb-setlist-head">
          <span>The sets</span>
          <span style={headNote}>Always three. Host picks the order</span>
        </div>
        <ul style={list}>
          {rounds.map((round) => (
            <li key={round.type} className="sb-row" style={rowTop}>
              <div className="sb-row-grow">
                <div className="sb-row-title">{round.name}</div>
                <div style={small}>{round.rule}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="sb-setlist">
        <div className="sb-setlist-head">
          <span>House rules</span>
          <span style={headNote}>Three things to know</span>
        </div>
        <ul style={list}>
          {HOUSE_RULES.map((rule) => (
            <li key={rule.key} className="sb-row" style={rowTop}>
              <span className="sb-row-key" style={{ paddingTop: 2 }}>
                {rule.key}
              </span>
              <div className="sb-row-grow" style={{ ...small, marginTop: 0 }}>
                {rule.text}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ textAlign: "right" }}>
        <Marker tone="blue">{"that's the whole thing. go be loud."}</Marker>
      </div>
    </div>
  )
}
