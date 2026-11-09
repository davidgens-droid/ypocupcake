"use client"

// Salad Bowl — the front door (/saladbowl). The poster: an all-access
// laminate on a sunset, then the two ways in (start a game, join a game).
import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"

import { errorText } from "@/lib/saladbowl/api"
import { lastName, recentGames, withProfile } from "@/lib/saladbowl/seats"
import { createGame } from "@/lib/saladbowl/store"

import { HowToPlay } from "./rules"
import { Button, Card, Display, Kicker, Liner, Marker, Marquee, Page, Pass, Stamp } from "./ui"

// ─── what this phone remembers ───────────────────────────────────────────────
// localStorage does not exist during server render, so both values are read
// through useSyncExternalStore (server snapshot = nothing remembered).

type RecentGame = { code: string; at: number }

const NO_GAMES: RecentGame[] = []
let recentCache: { key: string; list: RecentGame[] } = { key: "", list: NO_GAMES }

/** Same array back until the list of codes actually changes. */
function readRecent(): RecentGame[] {
  const list = recentGames()
  const key = list.map((g) => g.code).join(",")
  if (key !== recentCache.key) recentCache = { key, list: list.length ? list : NO_GAMES }
  return recentCache.list
}
function serverRecent(): RecentGame[] {
  return NO_GAMES
}
function serverName(): string {
  return ""
}
function subscribeStorage(listener: () => void) {
  window.addEventListener("storage", listener)
  return () => window.removeEventListener("storage", listener)
}

// ─── copy ────────────────────────────────────────────────────────────────────

const LANYARD = [
  "Salad Bowl",
  "The Word Tour",
  "Live in your living room",
  "One bowl",
  "Three sets",
  "No accounts",
  "Bring your loudest friends",
]

const NOTES: { title: string; text: string }[] = [
  { title: "Everyone on their own phone.", text: "No paper to tear up, no pens to find, no bowl to wash." },
  { title: "No accounts, no app.", text: "Open the link or scan the code, type a name, you're in." },
  { title: "Your phone tells you when you're up.", text: "It flashes and sounds off, so nobody has to keep track of whose turn it is." },
  { title: "Big screen mode.", text: "Put the scoreboard and the clock on a TV. It never shows the words." },
  { title: "Share a phone.", text: "Someone without one? Add a second player and pass it between you." },
]

// ─── the lanyard the laminate hangs from ─────────────────────────────────────

const strap: CSSProperties = {
  position: "absolute",
  bottom: 10,
  width: "75%",
  height: 18,
  background: "var(--sb-ink)",
  color: "#fff",
  borderTop: "2px solid var(--sb-pink)",
  borderBottom: "2px solid var(--sb-pink)",
  boxShadow: "0 3px 0 rgba(0, 0, 0, 0.25)",
  fontFamily: "var(--sb-cond)",
  fontWeight: 700,
  fontSize: "0.56rem",
  lineHeight: "14px",
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
}

function Lanyard() {
  const text = "Salad Bowl ★ The Word Tour ★ Salad Bowl ★ The Word Tour"
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height: 84,
        // Reach up to the very top of the page so the straps run off the edge.
        marginTop: "calc(-1 * max(14px, env(safe-area-inset-top)))",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <span style={{ ...strap, right: "50%", transformOrigin: "100% 50%", transform: "rotate(34deg)" }}>{text}</span>
      <span style={{ ...strap, left: "50%", transformOrigin: "0 50%", transform: "rotate(-34deg)" }}>{text}</span>
    </div>
  )
}

const clip: CSSProperties = {
  position: "absolute",
  top: -24,
  left: "50%",
  zIndex: 2,
  width: 26,
  height: 46,
  marginLeft: -13,
  borderRadius: 7,
  border: "2.5px solid var(--sb-ink)",
  background: "linear-gradient(180deg, #f1f1f5 0%, #b9b9c6 55%, #8f8f9d 100%)",
  boxShadow: "inset 0 -12px 0 rgba(0, 0, 0, 0.12), 2px 3px 0 rgba(0, 0, 0, 0.35)",
  pointerEvents: "none",
}

const lineupLabel: CSSProperties = { opacity: 0.62, marginBottom: 3 }
const lineupBody: CSSProperties = { fontSize: "0.92rem", lineHeight: 1.25, marginTop: 2 }

// ─── the page ────────────────────────────────────────────────────────────────

export function Landing() {
  const router = useRouter()
  const savedName = useSyncExternalStore(subscribeStorage, lastName, serverName)
  const recent = useSyncExternalStore(subscribeStorage, readRecent, serverRecent)

  // null = untouched, so the remembered name shows until they type.
  const [draft, setDraft] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [starting, setStarting] = useState(false)
  const [joining, setJoining] = useState(false)
  const [problem, setProblem] = useState<{ text: string; n: number } | null>(null)

  const name = (draft ?? savedName).slice(0, 20)

  function fail(text: string) {
    setProblem((p) => ({ text, n: (p?.n ?? 0) + 1 }))
  }

  async function start(e: FormEvent) {
    e.preventDefault()
    if (starting) return
    const clean = name.trim()
    if (!clean) return fail(errorText("name"))
    setStarting(true)
    setProblem(null)
    const res = await createGame(clean)
    if (!res.ok) {
      setStarting(false)
      return fail(errorText(res.error))
    }
    router.push(withProfile(`/saladbowl/${res.code}`))
  }

  function typeCode(raw: string) {
    // Pasting the whole invite link works too.
    const link = /saladbowl\/([a-z]{4})(?![a-z])/i.exec(raw)
    setCode((link ? link[1] : raw.replace(/[^a-z]/gi, "")).toUpperCase().slice(0, 4))
  }

  function join(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 4 || joining) return
    setJoining(true)
    router.push(withProfile(`/saladbowl/${code}`))
  }

  return (
    <>
      <div style={{ background: "var(--sb-ink)", paddingTop: "env(safe-area-inset-top)" }}>
        <Marquee items={LANYARD} />
      </div>

      <Page tone="sunset">
        {/* ── the laminate ── */}
        <div>
          <Lanyard />
          <div style={{ position: "relative", transform: "rotate(-1deg)", transformOrigin: "50% 0" }}>
            <span aria-hidden style={clip} />
            <Pass
              className="sb-pop"
              foot={
                <>
                  <div style={{ flex: "none" }}>
                    <div className="sb-barcode" style={{ width: 96 }} aria-hidden />
                    <div className="sb-fine" style={{ marginTop: 4 }}>
                      Pass 0001 to 0040
                    </div>
                  </div>
                  <div className="sb-fine" style={{ textAlign: "right", minWidth: 0 }}>
                    <b>Access: the couch</b>
                    <br />
                    Valid one loud night
                    <br />
                    No refunds on bad clues
                  </div>
                </>
              }
            >
              <div style={{ textAlign: "center" }}>
                <Display variant="pop" size="clamp(2.7rem, 14.5vw, 5.4rem)">
                  Salad Bowl
                </Display>
                <Display as="p" size="clamp(1.1rem, 6vw, 2rem)" style={{ marginTop: 10, letterSpacing: "0.04em" }}>
                  Live in your living room
                </Display>
                <p className="sb-kicker" style={{ marginTop: 8, color: "#d81f7c" }}>
                  The phones-out party game
                </p>
              </div>

              <div className="sb-holo">The Word Tour</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <div className="sb-fine" style={lineupLabel}>
                    The headliners
                  </div>
                  <Display as="div" size="1.35rem">
                    You
                  </Display>
                  <div style={lineupBody}>+ your loudest friends</div>
                </div>
                <div>
                  <div className="sb-fine" style={lineupLabel}>
                    The rules
                  </div>
                  <Display as="div" size="1.35rem">
                    Three sets
                  </Display>
                  <div style={lineupBody}>one bowl of words</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "16px 0 4px 6px" }}>
                <Stamp>No talent required</Stamp>
                <Marker tone="blue" arrow="left">
                  really
                </Marker>
              </div>
            </Pass>
          </div>
        </div>

        {/* ── jump back in ── */}
        {recent.length > 0 && (
          <section className="sb-rise" aria-label="Jump back in">
            <Kicker>Jump back in</Kicker>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {recent.map((g) => (
                <Link
                  key={g.code}
                  className="sb-chip"
                  href={withProfile(`/saladbowl/${g.code}`)}
                  style={{ minHeight: 44, padding: "8px 16px", letterSpacing: "0.14em", textDecoration: "none" }}
                >
                  <span>Game {g.code}</span>
                  <ArrowRight size={16} aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── start a game ── */}
        <Card tape bar="yellow" className="sb-rise">
          <form onSubmit={start} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Kicker tone="ink">Hosting tonight?</Kicker>
              <h2 className="sb-card-title" style={{ fontSize: "2rem", margin: "4px 0 0" }}>
                Start a game
              </h2>
              <p style={{ margin: "8px 0 0" }}>
                You get a four-letter code and a QR to share. Everyone else joins on their own phone.
              </p>
            </div>
            <div className="sb-field">
              <label htmlFor="sb-start-name">Your name</label>
              <input
                id="sb-start-name"
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
            <Button type="submit" disabled={starting}>
              {starting ? (
                "Setting the stage"
              ) : (
                <>
                  Start a game <ArrowRight size={22} aria-hidden />
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* ── join a game ── */}
        <Liner label="Got a code?" className="sb-rise">
          <form onSubmit={join} noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Display as="h2" size="2rem">
                Join a game
              </Display>
              <p className="sb-muted" style={{ margin: "6px 0 0" }}>
                Type the four letters from the host&apos;s screen.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "stretch", paddingBottom: 6 }}>
              <input
                className="sb-input sb-input--code"
                style={{ flex: 1, minWidth: 0 }}
                value={code}
                onChange={(e) => typeCode(e.target.value)}
                placeholder="CODE"
                aria-label="Game code, four letters"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <Button type="submit" variant="cyan" inline disabled={code.length !== 4 || joining} style={{ flex: "none" }}>
                {joining ? "Going" : "Join"}
              </Button>
            </div>
          </form>
        </Liner>

        {/* ── how it works ── */}
        <Card tape="corners" bar="pink">
          <Kicker tone="ink">Never played?</Kicker>
          <h2 className="sb-card-title" style={{ fontSize: "2rem", margin: "4px 0 14px" }}>
            How it works
          </h2>
          <HowToPlay />
        </Card>

        <Liner label="Liner notes">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {NOTES.map((note) => (
              <li key={note.title} style={{ display: "flex", gap: 10 }}>
                <span aria-hidden style={{ flex: "none", color: "var(--sb-pink)", fontSize: "0.7rem", lineHeight: "1.45rem" }}>
                  ▼
                </span>
                <span style={{ fontSize: "0.98rem" }}>
                  <b>{note.title}</b> {note.text}
                </span>
              </li>
            ))}
          </ul>
        </Liner>

        <footer style={{ marginTop: "auto", padding: "10px 0 4px", textAlign: "center", color: "var(--sb-ink)" }}>
          <Display as="p" size="1.6rem" style={{ letterSpacing: "0.06em" }}>
            Salad Bowl
          </Display>
          <p className="sb-fine" style={{ margin: "6px 0 0" }}>
            One bowl. Three sets. Zero paper cuts.
          </p>
          <p className="sb-fine" style={{ margin: "2px 0 0", opacity: 0.72 }}>
            Also known as Fishbowl. Best played loud.
          </p>
        </footer>
      </Page>
    </>
  )
}
