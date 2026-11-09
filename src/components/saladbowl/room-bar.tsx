"use client"

// Salad Bowl — the strip across the top of every in-game screen (game code,
// who this phone is playing as, sound, menu) and the menu it opens.
import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Menu, SlidersHorizontal, Tv, UserPlus } from "lucide-react"

import { errorText } from "@/lib/saladbowl/api"
import { withProfile } from "@/lib/saladbowl/seats"

import type { ScreenProps } from "./props"
import { HowToPlay } from "./rules"
import { SharePanel } from "./share"
import { Button, Kicker, MuteButton, Sheet, TeamDot, toast } from "./ui"

/**
 * Top strip. Inherits the page's text colour, so it works on black and on
 * team-coloured pages. `extra` adds buttons before the menu (e.g. host tools).
 */
/** A host-only shortcut shown at the top of the menu (lobby: the rules; mid-game: host controls). */
export interface HostShortcut {
  label: string
  note: string
  onClick: () => void
}

export function TopBar({ store, snap, state, extra, hostShortcut }: ScreenProps & { extra?: ReactNode; hostShortcut?: HostShortcut }) {
  const [open, setOpen] = useState(false)
  const me = state.me
  return (
    <>
      <header className="sb-topbar">
        <button
          type="button"
          className="sb-topbar-code"
          style={{ background: "none", border: 0, color: "inherit", padding: 0, cursor: "pointer" }}
          onClick={() => setOpen(true)}
          aria-label={`Game code ${state.code}. Open menu`}
        >
          <small>Game</small>
          {state.code}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {me && (
            <span className="sb-chip sb-chip--ink" style={{ maxWidth: 150, minWidth: 0 }} data-team={me.team ?? 0}>
              <TeamDot team={me.team} />
              <span>{me.name}</span>
            </span>
          )}
          {extra}
          <MuteButton />
          <button type="button" className="sb-iconbtn" aria-label="Menu" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
        </div>
      </header>
      <RoomMenu store={store} snap={snap} state={state} open={open} onClose={() => setOpen(false)} hostShortcut={hostShortcut} />
    </>
  )
}

function RoomMenu({
  store,
  snap,
  state,
  open,
  onClose,
  hostShortcut,
}: ScreenProps & { open: boolean; onClose: () => void; hostShortcut?: HostShortcut }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const canJoin = state.status !== "finished"
  // Leaving as the host would leave the game with nobody able to run it.
  const hostHere =
    state.status !== "finished" &&
    state.players.some((p) => p.host && snap.seats.some((s) => s.playerId === p.id)) &&
    state.players.some((p) => !snap.seats.some((s) => s.playerId === p.id))

  async function addPlayer(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const res = await store.join(name)
    if (!res.ok) return toast(errorText(res.error), true)
    toast(`${name.trim()} is in. This phone now plays for both of you.`)
    setName("")
    setAdding(false)
  }

  function leave() {
    store.forgetSeats()
    router.push(withProfile("/saladbowl"))
  }

  return (
    <Sheet open={open} onClose={onClose} title="Backstage">
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {hostShortcut && state.me?.host && (
          <section>
            <Kicker tone="ink">You&apos;re the host</Kicker>
            <p style={{ margin: "6px 0 10px", fontSize: "0.95rem" }}>{hostShortcut.note}</p>
            <div style={{ paddingBottom: 6 }}>
              <Button
                variant="yellow"
                onClick={() => {
                  onClose()
                  hostShortcut.onClick()
                }}
              >
                <SlidersHorizontal size={20} /> {hostShortcut.label}
              </Button>
            </div>
          </section>
        )}

        <section>
          <Kicker tone="ink">On this phone</Kicker>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {snap.seats.map((s) => {
              const p = state.players.find((x) => x.id === s.playerId)
              const active = snap.seat?.playerId === s.playerId
              return (
                <button
                  key={s.playerId}
                  type="button"
                  className={`sb-chip ${active ? "sb-chip--team" : ""}`}
                  data-team={p?.team ?? 0}
                  aria-pressed={active}
                  onClick={() => store.switchSeat(s.playerId)}
                >
                  <TeamDot team={p?.team} />
                  <span>{p?.name ?? s.name ?? "Player"}</span>
                </button>
              )
            })}
            {canJoin && !adding && (
              <button type="button" className="sb-chip" onClick={() => setAdding(true)}>
                <UserPlus size={16} />
                <span>Add a player</span>
              </button>
            )}
          </div>
          {snap.seats.length > 1 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.92rem" }}>
              Tap a name to play as them. The screen switches by itself when it&apos;s their turn.
            </p>
          )}
          {adding && (
            <form onSubmit={addPlayer} style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                className="sb-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Their name"
                maxLength={20}
                autoFocus
                aria-label="Name of the player sharing this phone"
              />
              <Button type="submit" size="sm" inline disabled={!name.trim() || snap.pending === "join"}>
                Add
              </Button>
            </form>
          )}
          {!adding && canJoin && snap.seats.length === 1 && (
            <p style={{ margin: "8px 0 0", fontSize: "0.92rem" }}>
              Someone without a phone? Add them here and share this one.
            </p>
          )}
        </section>

        {canJoin && (
          <section>
            <Kicker tone="ink">Get people in</Kicker>
            <div style={{ marginTop: 10 }}>
              <SharePanel code={state.code} qrSize={170} />
            </div>
          </section>
        )}

        <section>
          <Kicker tone="ink">Big screen</Kicker>
          <p style={{ margin: "6px 0 10px", fontSize: "0.95rem" }}>
            Put the scoreboard and clock on a TV or laptop. It never shows the words.
          </p>
          <Link
            className="sb-btn sb-btn--sm sb-btn--cyan"
            href={withProfile(`/saladbowl/${state.code}/tv`)}
            target="_blank"
            rel="noreferrer"
          >
            <Tv size={18} /> Open the big screen
          </Link>
        </section>

        <section>
          <Kicker tone="ink">How to play</Kicker>
          <div style={{ marginTop: 8 }}>
            <HowToPlay noProperNouns={state.settings.noProperNouns === true} />
          </div>
        </section>

        <section style={{ borderTop: "2px dashed rgba(12,12,14,.4)", paddingTop: 14 }}>
          {!confirmLeave ? (
            <button type="button" className="sb-link" onClick={() => setConfirmLeave(true)}>
              Leave this game on this phone
            </button>
          ) : hostHere ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0 }}>
                You are running this game, so it would be stuck without this phone. Hand the show over first: tap a
                player&apos;s name and choose Make host.
              </p>
              <div>
                <Button size="sm" variant="paper" onClick={() => setConfirmLeave(false)}>
                  Stay
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0 }}>
                This phone will forget its seat{snap.seats.length > 1 ? "s" : ""}. To get back in you&apos;d need the host
                to send you a link.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <Button size="sm" variant="pink" onClick={leave}>
                  Yes, leave
                </Button>
                <Button size="sm" variant="paper" onClick={() => setConfirmLeave(false)}>
                  Stay
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Sheet>
  )
}
