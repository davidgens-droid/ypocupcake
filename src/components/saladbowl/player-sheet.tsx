"use client"

// Salad Bowl — the host's tools for one player: move them to another team,
// rescue them when their phone dies, hand over hosting, or take them out.
// Used from the lobby and from the in-game screens, so it works in every
// game status.
import { useState, type ReactNode } from "react"
import { Check, Copy, Crown, Link2, Share2, Smartphone, UserMinus } from "lucide-react"

import { errorText } from "@/lib/saladbowl/api"
import type { Player } from "@/lib/saladbowl/types"

import type { ScreenProps } from "./props"
import { QrCode } from "./share"
import { Button, Kicker, Sheet, cx, toast } from "./ui"

/** Host-only actions for one player. Open while `playerId` is non-null. */
export function PlayerSheet({ store, snap, state, playerId, onClose }: ScreenProps & { playerId: string | null; onClose: () => void }) {
  // If the player vanishes (removed elsewhere) the sheet simply closes.
  const player = playerId ? state.players.find((p) => p.id === playerId) : undefined
  const open = !!player && !!state.me?.host
  return (
    <Sheet open={open} onClose={onClose} title={player?.name ?? "Player"}>
      {open && player && (
        // Keyed so confirm steps and links never leak from one player to the next.
        <PlayerActions key={player.id} store={store} snap={snap} state={state} player={player} onClose={onClose} />
      )}
    </Sheet>
  )
}

function PlayerActions({ store, snap, state, player, onClose }: ScreenProps & { player: Player; onClose: () => void }) {
  const [confirm, setConfirm] = useState<"host" | "remove" | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const name = player.name
  const isMe = player.id === state.me?.id
  const inLobby = state.status === "lobby"
  const heldHere = snap.seats.some((s) => s.playerId === player.id)
  const pending = snap.pending
  const reissuing = pending === "host:reissue"
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"

  async function assign(team: number) {
    if (team === player.team) return
    const res = await store.host("assign", { playerId: player.id, team })
    if (!res.ok) return toast(errorText(res.error), true)
    toast(`${name} is now in ${state.settings.teams[team]?.name ?? "that team"}.`)
    onClose()
  }

  async function makeLink() {
    const res = await store.seatLink(player.id)
    if (!res.ok) return toast(errorText(res.error), true)
    setLink(res.url)
  }

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast("Couldn't copy it. Have them scan the QR code instead.", true)
    }
  }

  async function shareLink() {
    if (!link) return
    try {
      await navigator.share({ title: "Salad Bowl", text: `${name}, here is your seat in Salad Bowl.`, url: link })
    } catch {
      // closed the share sheet: nothing to do
    }
  }

  async function playHere() {
    const res = await store.takeSeat(player.id)
    if (!res.ok) return toast(errorText(res.error), true)
    const now = store.getSnapshot()
    const t = now.state?.status === "playing" ? now.state.turn : null
    toast(
      now.seat?.playerId === player.id
        ? `Got it. This phone is playing as ${name} now.`
        : t?.playerId === player.id && t.state === "paused"
          ? `Got it. This phone switches to ${name} when you resume.`
          : `Got it. This phone switches to ${name} when they are up.`
    )
    onClose()
  }

  async function makeHost() {
    const res = await store.host("make_host", { playerId: player.id })
    if (!res.ok) {
      setConfirm(null)
      return toast(errorText(res.error), true)
    }
    toast(`${name} is the host now.`)
    onClose()
  }

  async function remove() {
    const res = await store.host("remove", { playerId: player.id })
    if (!res.ok) {
      setConfirm(null)
      return toast(errorText(res.error), true)
    }
    toast(`${name} is out of the game.`)
    onClose()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p className="sb-cond" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={cx("sb-dot", player.online ? "sb-dot--live" : "sb-dot--away")} aria-hidden />
        {isMe ? "This is you" : player.online ? "Phone is connected" : "Phone looks asleep or gone"}
        {inLobby && (
          <span style={{ opacity: 0.65 }}>
            / {player.words} of {state.settings.wordsPerPlayer} words written
          </span>
        )}
      </p>

      <Block title="Move to team" note={`Tap a team to put ${isMe ? "yourself" : name} on it.${inLobby ? "" : " Scores stay with the teams."}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.settings.teams.map((team, i) => {
            const current = player.team === i
            return (
              <Button
                key={i}
                size="sm"
                variant="team"
                data-team={i}
                aria-pressed={current}
                disabled={pending === "host:assign"}
                style={{ width: "100%", justifyContent: "space-between", textAlign: "left" }}
                onClick={() => assign(i)}
              >
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{team.name}</span>
                {current && (
                  <span className="sb-cond" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.82rem", flex: "none" }}>
                    <Check size={18} strokeWidth={3.5} /> Here now
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </Block>

      {!isMe && (
        <Block title="Lost phone or dead battery?" note={`Two ways to keep ${name} in the game. Either one signs their old phone out.${inLobby ? " Their words so far are handed back, so they write them again." : ""}`}>
          {link ? (
            <div className="sb-rise" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
              <QrCode value={link} size={190} />
              <p style={{ margin: 0 }}>
                Scan this, or open the link, on any phone. That phone becomes {name}&apos;s seat, and the old phone is signed out.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <Button size="sm" variant="paper" onClick={copyLink}>
                  <Copy size={18} /> {copied ? "Copied!" : "Copy link"}
                </Button>
                {canShare && (
                  <Button size="sm" variant="cyan" onClick={shareLink}>
                    <Share2 size={18} /> Send it
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Choice
              text={`Makes a link and QR code. Open it on any phone and ${name} is seated there.`}
              action={
                <Button size="sm" variant="cyan" disabled={reissuing} onClick={makeLink}>
                  <Link2 size={18} /> Send them a link
                </Button>
              }
            />
          )}
          {heldHere ? (
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              {name} already plays on this phone. The screen switches to them when they are up.
            </p>
          ) : (
            <Choice
              text={`No spare phone? ${name} shares yours. It switches to them when they are up.`}
              action={
                <Button size="sm" variant="paper" disabled={reissuing} onClick={playHere}>
                  <Smartphone size={18} /> Play their turns on my phone
                </Button>
              }
            />
          )}
        </Block>
      )}

      {!player.host && !isMe && (
        <Block title="Hand over the show" note={`${name} gets the host controls: rules, teams, pausing and starting.`}>
          {confirm === "host" ? (
            <Confirm
              question={`Make ${name} the host? You stop being host.`}
              yes="Yes, hand it over"
              busy={pending === "host:make_host"}
              onYes={makeHost}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <div>
              <Button size="sm" variant="yellow" onClick={() => setConfirm("host")}>
                <Crown size={18} /> Make host
              </Button>
            </div>
          )}
        </Block>
      )}

      {!isMe && (
        <Block
          title="Remove from game"
          note={inLobby ? `Takes ${name} out. The words they wrote go too.` : `Takes ${name} out. The words they wrote stay in the bowl.`}
        >
          {confirm === "remove" ? (
            <Confirm
              question={`Remove ${name}? ${inLobby ? "Their words leave the bowl." : "Their team plays on without them."}`}
              yes="Yes, remove"
              busy={pending === "host:remove"}
              onYes={remove}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <div>
              <Button size="sm" variant="pink" onClick={() => setConfirm("remove")}>
                <UserMinus size={18} /> Remove {name}
              </Button>
            </div>
          )}
        </Block>
      )}

      {isMe && (
        <p style={{ margin: 0, fontSize: "0.95rem" }}>
          To hand over hosting or help someone with a dead phone, tap their name instead.
        </p>
      )}
    </div>
  )
}

function Block({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "2px dashed rgba(12,12,14,.3)", paddingTop: 14 }}>
      <div>
        <Kicker tone="ink">{title}</Kicker>
        <p style={{ margin: "4px 0 0", fontSize: "0.95rem" }}>{note}</p>
      </div>
      {children}
    </section>
  )
}

function Choice({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      {action}
      <p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.75 }}>{text}</p>
    </div>
  )
}

function Confirm({ question, yes, busy, onYes, onNo }: { question: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="sb-pop" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
        {question}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button size="sm" variant="pink" disabled={busy} onClick={onYes}>
          {yes}
        </Button>
        <Button size="sm" variant="paper" disabled={busy} onClick={onNo}>
          Keep as is
        </Button>
      </div>
    </div>
  )
}
