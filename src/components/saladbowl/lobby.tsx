"use client"

// Salad Bowl — the lobby ("soundcheck"). Everyone writes their words; the
// host invites people, sorts the teams, sets the set list and rules, then
// starts the show.
import { useState, type FormEvent } from "react"
import { Check, Pencil, QrCode as QrIcon, Settings as Gear, Shuffle, SlidersHorizontal } from "lucide-react"

import { errorText } from "@/lib/saladbowl/api"
import { ROUNDS, SKIP_RULES } from "@/lib/saladbowl/content"
import type { Player, Settings } from "@/lib/saladbowl/types"

import { LobbySettings } from "./lobby-settings"
import { LobbyWords } from "./lobby-words"
import { PlayerSheet } from "./player-sheet"
import type { ScreenProps } from "./props"
import { TopBar } from "./room-bar"
import { SharePanel } from "./share"
import { Button, Card, Display, Kicker, Label, Liner, Marker, Page, Stamp, TempoBadge, cx, toast } from "./ui"

/**
 * Host only: set or change tonight's theme right on the theme card (the
 * first thing a host looks for), with the rest of the rules one tap away.
 */
function HostTheme({ store, theme, letter }: { store: ScreenProps["store"]; theme: string; letter: string }) {
  // null = not editing; a string = the text being typed.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (draft === null || saving) return
    setSaving(true)
    const res = await store.host("settings", { theme: draft.trim() })
    setSaving(false)
    if (!res.ok) return toast(errorText(res.error), true)
    setDraft(null)
  }

  if (draft !== null) {
    return (
      <form onSubmit={save} noValidate style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="sb-field">
          <label htmlFor="sb-lobby-theme">Tonight&apos;s theme</label>
          <input
            id="sb-lobby-theme"
            className="sb-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={80}
            placeholder="e.g. 90s movies"
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <p style={{ margin: 0, fontSize: "0.92rem" }}>
          Everyone sees it while they write their words. Leave it empty for anything goes.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button type="submit" size="sm" disabled={saving}>
            <Check size={18} strokeWidth={3} /> Save theme
          </Button>
          <Button size="sm" variant="paper" disabled={saving} onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {!theme && (
        <p style={{ margin: 0, fontSize: "0.95rem" }}>
          {letter
            ? `No theme set yet: any word that starts with ${letter}. Add a theme before people start writing if you want one.`
            : "No theme set yet, so anything goes. Pick one before people start writing."}
        </p>
      )}
      <div>
        <Button size="sm" variant={theme ? "paper" : "yellow"} onClick={() => setDraft(theme)}>
          <Pencil size={18} /> {theme ? "Change theme" : "Set the theme"}
        </Button>
      </div>
    </div>
  )
}

/**
 * Host only: every setting of tonight's game at a glance, each one a button
 * into the "Set list & rules" sheet, so a first-time host can see straight
 * away what they are able to change and where.
 */
function HostDesk({ settings, nudge, onRules }: { settings: Settings; nudge: boolean; onRules: () => void }) {
  const s = settings
  const facts = [
    `${s.wordsPerPlayer} ${s.wordsPerPlayer === 1 ? "word" : "words"} each`,
    `${s.turnSeconds} second turns`,
    `${s.teams.length} teams`,
    s.letter ? `Starts with ${s.letter}` : "Any starting letter",
    SKIP_RULES[s.skipRule].name,
    s.carryOver ? "Leftover time carries over" : "Leftover time is lost",
  ]
  return (
    <Liner label="Host desk">
      <Display as="h2" size="1.8rem">
        You set the rules
      </Display>
      <p className="sb-muted" style={{ margin: "6px 0 12px", fontSize: "0.95rem" }}>
        This is how tonight is set up. Tap anything to change it.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {facts.map((fact) => (
          <button key={fact} type="button" className="sb-chip" style={{ minHeight: 44 }} onClick={onRules}>
            <span>{fact}</span>
          </button>
        ))}
        <button type="button" className="sb-chip" style={{ minHeight: 44, borderRadius: 14, textAlign: "left" }} onClick={onRules}>
          <span style={{ whiteSpace: "normal" }}>Sets: {s.rounds.map((r) => ROUNDS[r].name).join(", then ")}</span>
        </button>
      </div>
      <div style={{ marginTop: 14, paddingBottom: 6 }}>
        <Button className={nudge ? "sb-pulse" : undefined} onClick={onRules}>
          <SlidersHorizontal size={22} /> Set list &amp; rules
        </Button>
      </div>
    </Liner>
  )
}

export function Lobby({ store, snap, state }: ScreenProps) {
  const [sheetPlayer, setSheetPlayer] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Until the host has opened the rules once, the button draws the eye.
  const [rulesSeen, setRulesSeen] = useState(false)
  const openRules = () => {
    setRulesSeen(true)
    setSettingsOpen(true)
  }
  // null = follow the room (open while it is filling); true/false = the host chose.
  const [inviteChoice, setInviteChoice] = useState<boolean | null>(null)
  const [askStart, setAskStart] = useState(false)

  const me = state.me
  if (!me) return null

  const s = state.settings
  const isHost = me.host
  const per = s.wordsPerPlayer
  const players = state.players
  const hostName = players.find((p) => p.host)?.name ?? "the host"

  const rosters = s.teams.map((_, i) => players.filter((p) => p.team === i))
  const benched = players.filter((p) => p.team == null || p.team >= s.teams.length)
  const short = rosters.map((list, i) => ({ team: i, missing: Math.max(0, 2 - list.length) })).filter((t) => t.missing > 0)
  const writing = players.filter((p) => p.words < per)

  // What the server will refuse, said before anyone taps.
  let blocked: string | null = null
  if (short.length === 1) {
    const t = short[0]
    blocked = `${s.teams[t.team].name} needs ${t.missing} more ${t.missing === 1 ? "player" : "players"}.`
  } else if (short.length > 1) {
    blocked = "Every team needs at least 2 players."
  } else if (state.bowl.total < 3) {
    blocked = `The bowl needs at least 3 words. It has ${state.bowl.total}.`
  }

  const stillWriting =
    writing.length === 0 ? null : writing.length === 1 ? `${writing[0].id === me.id ? "You are" : `${writing[0].name} is`} still writing` : `${writing.length} people are still writing`
  const confirming = askStart && !blocked && writing.length > 0
  const starting = snap.pending === "host:start"
  const inviteOpen = inviteChoice ?? short.length > 0

  const theme = s.theme.trim()
  const themeSize = theme.length > 44 ? "1.7rem" : theme.length > 24 ? "2.1rem" : theme.length > 12 ? "2.6rem" : "3.2rem"

  async function start() {
    if (blocked || starting) return
    if (writing.length > 0 && !askStart) {
      setAskStart(true)
      return
    }
    const res = await store.host("start")
    if (!res.ok) {
      setAskStart(false)
      toast(errorText(res.error), true)
    }
  }

  async function shuffle() {
    const res = await store.host("shuffle")
    if (!res.ok) toast(errorText(res.error), true)
  }

  const openPlayer = isHost ? (id: string) => setSheetPlayer(id) : null

  return (
    <Page>
      <TopBar
        store={store}
        snap={snap}
        state={state}
        extra={
          me.host ? (
            <button type="button" className="sb-iconbtn" aria-label="Set list and rules" onClick={openRules}>
              <Gear size={22} />
            </button>
          ) : undefined
        }
        hostShortcut={
          me.host
            ? { label: "Set list & rules", note: "Theme, starting letter, words each, turn length, teams, the order of the sets and skipping.", onClick: openRules }
            : undefined
        }
      />

      {/* ── headline ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <Kicker>Soundcheck</Kicker>
          <Display variant="glow" size="clamp(2.7rem, 13.5vw, 4.3rem)" style={{ marginTop: 6 }}>
            Fill the bowl
          </Display>
        </div>
        <TempoBadge key={state.bowl.total} className="sb-pop" value={state.bowl.total} top="The bowl" bottom={state.bowl.total === 1 ? "word" : "words"} size={112} ring="var(--sb-yellow)" />
      </header>

      {/* ── tonight's theme ── */}
      <Card tape tilt="l" bar="yellow">
        <Kicker tone="ink">Tonight&apos;s theme</Kicker>
        <Display as="h2" variant="pop" size={themeSize} style={{ margin: "8px 0 14px" }}>
          {theme || (s.letter ? `Anything starting with ${s.letter}` : "Anything goes")}
        </Display>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {s.letter && <Stamp>Starts with {s.letter}</Stamp>}
          <span className="sb-cond" style={{ fontSize: "1.05rem" }}>
            {per} {per === 1 ? "word" : "words"} each
          </span>
        </div>
        {isHost && <HostTheme store={store} theme={theme} letter={s.letter} />}
      </Card>

      {/* ── host: everything you can change ── */}
      {isHost && <HostDesk settings={s} nudge={!rulesSeen} onRules={openRules} />}

      {/* ── host: get people in ── */}
      {isHost &&
        (inviteOpen ? (
          <Card tape="corners" className="sb-rise">
            <div style={{ textAlign: "center", marginBottom: 12 }}>
              <h2 className="sb-card-title" style={{ margin: 0 }}>
                Get the band in
              </h2>
              <p style={{ margin: "4px 0 0", fontSize: "0.95rem" }}>Everyone scans this, or types the code, on their own phone.</p>
            </div>
            <SharePanel code={state.code} />
            <div style={{ textAlign: "center", marginTop: 10 }}>
              <button type="button" className="sb-link" style={{ minHeight: 44 }} onClick={() => setInviteChoice(false)}>
                Hide the invite
              </button>
            </div>
          </Card>
        ) : (
          <Button variant="ghost" onClick={() => setInviteChoice(true)}>
            <QrIcon size={18} /> Show the invite code
          </Button>
        ))}

      {/* ── your words ── */}
      <LobbyWords store={store} snap={snap} state={state} />

      {/* ── the line-up ── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <Kicker>
              {players.length} in the room / {state.bowl.total} {state.bowl.total === 1 ? "word" : "words"} in
            </Kicker>
            <Display as="h2" size="2.4rem" style={{ marginTop: 4 }}>
              The line-up
            </Display>
          </div>
          {isHost && (
            <Button size="sm" variant="paper" disabled={snap.pending === "host:shuffle"} onClick={shuffle}>
              <Shuffle size={18} /> Shuffle teams
            </Button>
          )}
        </div>
        {isHost && (
          <div>
            <Marker tone="yellow">tap a name to move them, or to rescue a dead phone ↓</Marker>
          </div>
        )}

        {s.teams.map((team, i) => {
          const roster = rosters[i]
          const missing = Math.max(0, 2 - roster.length)
          return (
            <section
              key={i}
              data-team={i}
              style={{
                background: "var(--sb-team)",
                color: "var(--sb-ink)",
                border: "3px solid var(--sb-ink)",
                borderRadius: 14,
                boxShadow: "0 0 0 2px rgba(255,255,255,.14)",
                padding: "12px 12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <Display as="h3" variant="pop-soft" size="1.75rem" style={{ minWidth: 0 }}>
                  {team.name}
                </Display>
                <Label tone={missing > 0 ? undefined : "paper"}>{missing > 0 ? `Needs ${missing} more` : `${roster.length} players`}</Label>
              </div>
              {roster.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {roster.map((p) => (
                    <PlayerChip key={p.id} player={p} per={per} mine={p.id === me.id} onTap={openPlayer} />
                  ))}
                </div>
              ) : (
                <p className="sb-cond" style={{ margin: 0, opacity: 0.7 }}>
                  Nobody here yet
                </p>
              )}
            </section>
          )
        })}

        {benched.length > 0 && (
          <section style={{ border: "2.5px dashed rgba(255,255,255,.45)", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <Kicker tone="muted">{isHost ? "No team yet. Tap a name to place them" : "Waiting for a team"}</Kicker>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {benched.map((p) => (
                <PlayerChip key={p.id} player={p} per={per} mine={p.id === me.id} onTap={openPlayer} />
              ))}
            </div>
          </section>
        )}
      </section>

      {/* ── tonight's set list ── */}
      <Card tape tilt="r" style={{ marginTop: 14 }}>
        <div className="sb-setlist">
          <div className="sb-setlist-head">
            <span>Set list</span>
            <span style={{ fontSize: "0.7rem", opacity: 0.7, textAlign: "right" }}>Same words every set</span>
          </div>
          {s.rounds.map((type, i) => (
            <div key={type} className="sb-row" style={{ alignItems: "flex-start" }}>
              <span className="sb-row-key" style={{ minWidth: 0, width: 56, flex: "none", paddingTop: 2 }}>
                Set {i + 1}
              </span>
              <div className="sb-row-grow">
                <div className="sb-row-title">{ROUNDS[type].name}</div>
                <div style={{ fontSize: "0.92rem", marginTop: 2 }}>{ROUNDS[type].rule}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="sb-setlist" style={{ marginTop: 14 }}>
          <div className="sb-setlist-head">
            <span>House rules</span>
          </div>
          <div className="sb-row" style={{ alignItems: "flex-start" }}>
            <span className="sb-row-key" style={{ minWidth: 0, width: 56, flex: "none", paddingTop: 2 }}>
              Clock
            </span>
            <div className="sb-row-grow">
              <div className="sb-row-title">{s.turnSeconds} seconds a turn</div>
            </div>
          </div>
          <div className="sb-row" style={{ alignItems: "flex-start" }}>
            <span className="sb-row-key" style={{ minWidth: 0, width: 56, flex: "none", paddingTop: 2 }}>
              Skips
            </span>
            <div className="sb-row-grow">
              <div className="sb-row-title">{SKIP_RULES[s.skipRule].name}</div>
              <div style={{ fontSize: "0.92rem", marginTop: 2 }}>{SKIP_RULES[s.skipRule].detail}</div>
            </div>
          </div>
          <div className="sb-row" style={{ alignItems: "flex-start" }}>
            <span className="sb-row-key" style={{ minWidth: 0, width: 56, flex: "none", paddingTop: 2 }}>
              Carry
            </span>
            <div className="sb-row-grow">
              <div className="sb-row-title">{s.carryOver ? "Carries over" : "Use it or lose it"}</div>
              <div style={{ fontSize: "0.92rem", marginTop: 2 }}>
                {s.carryOver
                  ? "Empty the bowl early and you keep those seconds to open the next set."
                  : "Empty the bowl and your turn ends there."}
              </div>
            </div>
          </div>
        </div>
        {isHost && (
          <div style={{ marginTop: 14 }}>
            <Button size="sm" variant="cyan" onClick={openRules}>
              <SlidersHorizontal size={18} /> Change the set list
            </Button>
          </div>
        )}
      </Card>

      {/* ── showtime ── */}
      {isHost ? (
        <>
          {/* Leaves room so the pinned bar never covers the last card. */}
          <div style={{ height: confirming ? 168 : 124 }} aria-hidden />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              padding: "30px 16px max(14px, env(safe-area-inset-bottom))",
              background: "linear-gradient(180deg, rgba(12,12,14,0) 0, rgba(12,12,14,.96) 30px)",
              pointerEvents: "none",
            }}
          >
            <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto" }}>
              {blocked ? (
                <>
                  <div style={{ textAlign: "center" }} role="status">
                    <Marker tone="yellow">{blocked}</Marker>
                  </div>
                  <Button disabled>Start the show</Button>
                </>
              ) : confirming ? (
                <div className="sb-pop" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ textAlign: "center" }} role="alert">
                    <Kicker>{stillWriting}</Kicker>
                    <Display as="p" size="1.9rem" style={{ marginTop: 4 }}>
                      Start anyway?
                    </Display>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button variant="paper" style={{ flex: 1 }} disabled={starting} onClick={() => setAskStart(false)}>
                      Wait
                    </Button>
                    <Button variant="green" style={{ flex: 1.4 }} disabled={starting} onClick={start}>
                      Start anyway
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ textAlign: "center" }} role="status">
                    {stillWriting ? <Marker tone="yellow">{stillWriting}</Marker> : <Marker tone="white">everyone is all in. hit it!</Marker>}
                  </div>
                  <Button className={stillWriting ? undefined : "sb-pulse"} disabled={starting} onClick={start}>
                    Start the show
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "10px 0 22px", display: "flex", flexDirection: "column", gap: 6 }}>
          <Kicker tone="muted">{stillWriting ?? "Everyone is all in"}</Kicker>
          <Display as="p" size="1.5rem">
            Waiting for {hostName} to start the show.
          </Display>
        </div>
      )}

      {isHost && (
        <>
          <LobbySettings store={store} snap={snap} state={state} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <PlayerSheet store={store} snap={snap} state={state} playerId={sheetPlayer} onClose={() => setSheetPlayer(null)} />
        </>
      )}
    </Page>
  )
}

/** One player in the line-up: here/away dot, name, host tag, words written. */
function PlayerChip({ player, per, mine, onTap }: { player: Player; per: number; mine: boolean; onTap: ((id: string) => void) | null }) {
  const done = player.words >= per
  const label = `${player.name}${mine ? " (you)" : ""}${player.host ? ", host" : ""}, ${player.online ? "here" : "away"}, ${
    done ? "all words written" : `${player.words} of ${per} words written`
  }`
  const body = (
    <>
      <span className={cx("sb-dot", player.online ? "sb-dot--live" : "sb-dot--away")} style={mine ? { borderColor: "#fff" } : undefined} aria-hidden />
      <span>{player.name}</span>
      {mine && <i style={{ fontStyle: "normal", flex: "none", color: "var(--sb-yellow)" }}>You</i>}
      {player.host && (
        <i style={{ fontStyle: "normal", flex: "none", display: "inline-flex" }}>
          <Label tone="yellow">Host</Label>
        </i>
      )}
      <i style={{ fontStyle: "normal", flex: "none", display: "inline-flex", alignItems: "center", opacity: done ? 1 : 0.65 }}>
        {done ? <Check size={17} strokeWidth={4} /> : `${player.words}/${per}`}
      </i>
    </>
  )
  const className = cx("sb-chip", mine && "sb-chip--ink")
  if (onTap) {
    return (
      <button type="button" className={className} style={{ minHeight: 44 }} aria-label={`${label}. Open host tools`} onClick={() => onTap(player.id)}>
        {body}
      </button>
    )
  }
  return (
    <span className={className} style={{ minHeight: 38 }} role="img" aria-label={label}>
      {body}
    </span>
  )
}
