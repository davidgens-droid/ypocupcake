"use client"

// Salad Bowl — the host's "Set list & rules" sheet in the lobby. Every
// control writes straight to the server through store.host("settings", …)
// and the sheet re-renders from state.settings; only text being typed is
// kept locally until it is committed (blur or Enter).
import { useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Dices, Lightbulb, Minus, Plus } from "lucide-react"

import { errorText, fetchIdeas } from "@/lib/saladbowl/api"
import { BAND_NAMES, ROUNDS, SKIP_RULES, THEME_PRESETS, TURN_LENGTHS } from "@/lib/saladbowl/content"
import type { Settings, SkipRule } from "@/lib/saladbowl/types"

import type { ScreenProps } from "./props"
import { Button, Sheet, cx, toast } from "./ui"

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
const SKIP_ORDER: SkipRule[] = ["none", "one", "unlimited"]
// Ready-made themes whose only natural answers are names: hidden while the
// "no proper nouns" rule is on.
const NAME_ONLY_PRESETS = ["Famous people", "Brands"]
// Two-word examples for the "Which words need the letter?" notes: the first
// has every word on the letter, the second only its first word. Letters with
// no natural pair are left out and get a note without an example.
const LETTER_EXAMPLES: Record<string, [every: string, first: string]> = {
  A: ["Adam's apple", "Air guitar"],
  B: ["Big Ben", "Banana split"],
  C: ["Candy cane", "Corn dog"],
  D: ["Donald Duck", "Disco ball"],
  E: ["Easter egg", "Electric guitar"],
  F: ["French fries", "Fire truck"],
  G: ["Golden Gate", "Guitar solo"],
  H: ["Hula hoop", "Hot dog"],
  I: ["Indigo ink", "Ice cream"],
  J: ["Jumping jack", "Jelly bean"],
  K: ["King Kong", "Kitchen sink"],
  L: ["Lava lamp", "Light bulb"],
  M: ["Mickey Mouse", "Movie star"],
  N: ["Night nurse", "Nail polish"],
  O: ["Olive oil", "Orange juice"],
  P: ["Peter Pan", "Pop star"],
  Q: ["Quick quiz", "Queen bee"],
  R: ["Road Runner", "Rock star"],
  S: ["Solar system", "Snow globe"],
  T: ["Taco Tuesday", "Tour bus"],
  V: ["Vice versa", "Vinyl record"],
  W: ["Wild West", "Wedding cake"],
}

/** The "this throws words out, sure?" box under a control. */
const CONFIRM_BOX: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  border: "2.5px solid var(--sb-ink)",
  borderRadius: 12,
  padding: 12,
  background: "#fff",
}

/** A random entry (only ever called from a tap, never while rendering). */
function pickOne(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)]
}

export function LobbySettings({ store, snap, state, open, onClose }: ScreenProps & { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Set list & rules">
      {/* Mounted only while open, so half-typed drafts never outlive the sheet. */}
      {open && <SettingsBody store={store} snap={snap} state={state} onClose={onClose} />}
    </Sheet>
  )
}

function SettingsBody({ store, snap, state, onClose }: ScreenProps & { onClose: () => void }) {
  // True while a tap-driven change is in flight (text fields save quietly, so
  // that tapping a button straight after typing is never swallowed).
  const [working, setWorking] = useState(false)
  const [askLetter, setAskLetter] = useState<string | null>(null)
  // A stricter word rule waiting for a yes: "one" = one word only, "every" =
  // every word on the letter.
  const [askWords, setAskWords] = useState<"one" | "every" | null>(null)
  const [themeIdeas, setThemeIdeas] = useState<string[]>([])
  const [ideasBusy, setIdeasBusy] = useState(false)
  const [ideasError, setIdeasError] = useState<string | null>(null)

  const s = state.settings
  const wordsExist = state.bowl.total > 0
  // Games made before this rule existed carry no value: only true is "on".
  const noProperNouns = s.noProperNouns === true
  // The other way round for the idea machine: no value means "on", only false is "off".
  const aiHelper = s.aiHelper !== false
  // Phrases are allowed unless the host said otherwise: only false is "one word only".
  const multiWord = s.multiWord !== false
  // The host's choice, kept even while it has no effect (no letter, or one word only).
  const everyWord = s.everyWord === true
  // The examples include famous names, so they are left out under "no proper nouns".
  const examples = s.letter && !noProperNouns ? LETTER_EXAMPLES[s.letter] : undefined

  async function saveQuietly(patch: Partial<Settings>): Promise<boolean> {
    const res = await store.host("settings", patch)
    if (!res.ok) toast(errorText(res.error), true)
    return res.ok
  }

  async function save(patch: Partial<Settings>): Promise<boolean> {
    setWorking(true)
    const ok = await saveQuietly(patch)
    setWorking(false)
    return ok
  }

  // ── theme ──
  async function askThemes() {
    const token = snap.seat?.token
    if (!token) {
      setIdeasError(errorText("no_seat"))
      return
    }
    setIdeasBusy(true)
    setIdeasError(null)
    const res = await fetchIdeas(state.code, token, "themes")
    setIdeasBusy(false)
    if (!res.ok) {
      setIdeasError(errorText(res.error))
      return
    }
    setThemeIdeas(Array.isArray(res.ideas) ? res.ideas.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, 80)) : [])
  }

  // ── letter ──
  function pickProperNouns(on: boolean) {
    if (on === noProperNouns) return
    // A batch of theme ideas only fits the rule it was asked under.
    setThemeIdeas([])
    void save({ noProperNouns: on })
  }

  function pickLetter(letter: string) {
    if (letter === s.letter) {
      setAskLetter(null)
      return
    }
    // A pending "every word" question was about the old letter.
    if (askWords === "every") setAskWords(null)
    // Only a NEW letter throws words out; going back to "any" never does.
    if (letter !== "" && wordsExist) {
      setAskLetter(letter)
      return
    }
    setAskLetter(null)
    void save({ letter })
  }

  async function confirmLetter() {
    if (!askLetter) return
    await save({ letter: askLetter })
    setAskLetter(null)
  }

  // ── multiple words ──
  // Like a new letter, a stricter rule throws out the words that break it, so
  // it asks first once words exist. Loosening a rule never throws anything out.
  function pickMultiWord(on: boolean) {
    if (on === multiWord) {
      if (askWords === "one") setAskWords(null)
      return
    }
    if (!on && wordsExist) {
      setAskWords("one")
      return
    }
    setAskWords(null)
    void save({ multiWord: on })
  }

  function pickEveryWord(on: boolean) {
    if (on === everyWord) {
      if (askWords === "every") setAskWords(null)
      return
    }
    if (on && wordsExist) {
      setAskWords("every")
      return
    }
    setAskWords(null)
    void save({ everyWord: on })
  }

  async function confirmWords() {
    if (!askWords) return
    await save(askWords === "one" ? { multiWord: false } : { everyWord: true })
    setAskWords(null)
  }

  // ── teams ──
  // The server replaces the whole team list, so team edits go one at a time
  // and each one starts from the names the previous one saved.
  const teamEdits = useRef<Promise<boolean>>(Promise.resolve(true))
  function editTeams(change: (current: { name: string }[]) => { name: string }[] | null, quiet: boolean): Promise<boolean> {
    const next = teamEdits.current.then(() => {
      const current = (store.getSnapshot().state?.settings.teams ?? s.teams).map((t) => ({ name: t.name }))
      const teams = change(current)
      if (!teams) return true
      return quiet ? saveQuietly({ teams }) : save({ teams })
    })
    teamEdits.current = next
    return next
  }

  function setTeamCount(n: number) {
    if (n === s.teams.length) return
    void editTeams((current) => {
      if (n === current.length) return null
      const taken = current.map((t) => t.name)
      return Array.from({ length: n }, (_, i) => {
        if (current[i]) return { name: current[i].name }
        const fresh = BAND_NAMES.find((b) => !taken.includes(b)) ?? ""
        taken.push(fresh)
        return { name: fresh }
      })
    }, false)
  }

  function renameTeam(index: number, name: string, quiet: boolean) {
    return editTeams((current) => (index < current.length ? current.map((t, i) => ({ name: i === index ? name : t.name })) : null), quiet)
  }

  function rollName(index: number) {
    const taken = s.teams.map((t) => t.name)
    const pool = BAND_NAMES.filter((b) => !taken.includes(b))
    if (pool.length === 0) return
    void renameTeam(index, pickOne(pool), false)
  }

  // ── set list ──
  function moveRound(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= s.rounds.length) return
    const rounds = [...s.rounds]
    const [picked] = rounds.splice(index, 1)
    rounds.splice(to, 0, picked)
    void save({ rounds })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* ── theme ── */}
      <Section title="Theme" note="What should everyone write about? Leave it empty for anything goes.">
        <DraftInput
          value={s.theme}
          maxLength={80}
          placeholder="Anything goes"
          label="Theme"
          onCommit={(theme) => saveQuietly({ theme })}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {THEME_PRESETS.filter((preset) => !noProperNouns || !NAME_ONLY_PRESETS.includes(preset)).map((preset) => {
            // "Anything goes" is the empty theme.
            const value = preset === THEME_PRESETS[0] ? "" : preset
            const on = s.theme === value
            return (
              <button
                key={preset}
                type="button"
                className={cx("sb-chip", on && "sb-chip--ink")}
                style={{ minHeight: 44 }}
                aria-pressed={on}
                disabled={working}
                onClick={() => void save({ theme: value })}
              >
                <span>{preset}</span>
              </button>
            )
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <Button size="sm" variant="cyan" disabled={ideasBusy} onClick={askThemes}>
            <Lightbulb size={18} /> {ideasBusy ? "Thinking" : themeIdeas.length > 0 ? "More theme ideas" : "Ask for theme ideas"}
          </Button>
          {ideasError && (
            <div className="sb-error" role="alert">
              {ideasError}
            </div>
          )}
          {themeIdeas.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {themeIdeas.map((idea) => {
                const on = s.theme === idea
                return (
                  <button
                    key={idea}
                    type="button"
                    className={cx("sb-chip sb-rise", on ? "sb-chip--ink" : "sb-chip--soft")}
                    data-team={1}
                    style={{ minHeight: 44, textAlign: "left" }}
                    aria-pressed={on}
                    disabled={working}
                    onClick={() => void save({ theme: idea })}
                  >
                    <span style={{ whiteSpace: "normal" }}>{idea}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </Section>

      {/* ── set list ── */}
      <Section title="Set list" note="Always three sets, same words each time. Use the arrows to choose which comes first, second and last.">
        <ol className="sb-setlist" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {s.rounds.map((type, i) => {
            const info = ROUNDS[type]
            return (
              <li key={type} className="sb-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="sb-display" style={{ fontSize: "1.7rem", minWidth: 20 }} aria-hidden>
                    {i + 1}
                  </span>
                  <div className="sb-row-grow">
                    <div className="sb-row-title">{info.name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <IconButton label={`Move ${info.name} earlier`} disabled={working || i === 0} onClick={() => moveRound(i, -1)}>
                      <ArrowUp size={20} strokeWidth={3} />
                    </IconButton>
                    <IconButton label={`Move ${info.name} later`} disabled={working || i === s.rounds.length - 1} onClick={() => moveRound(i, 1)}>
                      <ArrowDown size={20} strokeWidth={3} />
                    </IconButton>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: "0.92rem" }}>{info.rule}</p>
              </li>
            )
          })}
        </ol>
      </Section>

      {/* ── letter ── */}
      <Section title="Starting letter" note="Optional. Pick a letter and every entry has to start with it.">
        <div className="sb-seg" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          <button
            type="button"
            style={{ gridColumn: "1 / -1", minWidth: 0 }}
            aria-pressed={s.letter === ""}
            disabled={working}
            onClick={() => pickLetter("")}
          >
            Any letter
          </button>
          {LETTERS.map((letter) => (
            <button
              key={letter}
              type="button"
              style={{ minWidth: 0, padding: 0 }}
              aria-pressed={s.letter === letter}
              aria-label={`Entries start with ${letter}`}
              disabled={working}
              onClick={() => pickLetter(letter)}
            >
              {letter}
            </button>
          ))}
        </div>
        {askLetter && (
          <div className="sb-pop" role="alert" style={CONFIRM_BOX}>
            <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
              Switch to {askLetter}?
            </p>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              Words are already in the bowl.{" "}
              {multiWord && everyWord ? `Any with a word that does not start with ${askLetter}` : `Any that do not start with ${askLetter}`} get
              thrown out, and whoever wrote them has to write new ones.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button size="sm" variant="pink" disabled={working} onClick={confirmLetter}>
                Yes, switch to {askLetter}
              </Button>
              <Button size="sm" variant="paper" disabled={working} onClick={() => setAskLetter(null)}>
                Keep {s.letter || "any letter"}
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* ── multiple words ── */}
      <Section
        title="Multiple words"
        note={
          multiWord
            ? "Entries can be more than one word, like ice cream."
            : "One word per entry. Hyphens are fine: T-shirt counts as one."
        }
      >
        <div className="sb-seg" role="group" aria-label="Multiple words">
          <button type="button" aria-pressed={multiWord} disabled={working} onClick={() => pickMultiWord(true)}>
            Allowed
          </button>
          <button type="button" aria-pressed={!multiWord} disabled={working} onClick={() => pickMultiWord(false)}>
            One word only
          </button>
        </div>
        {askWords === "one" && multiWord && (
          <div className="sb-pop" role="alert" style={CONFIRM_BOX}>
            <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
              Switch to one word only?
            </p>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              Words are already in the bowl. Any with more than one word get handed back to whoever wrote them to write again.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button size="sm" variant="pink" disabled={working} onClick={confirmWords}>
                Yes, one word only
              </Button>
              <Button size="sm" variant="paper" disabled={working} onClick={() => setAskWords(null)}>
                Keep phrases
              </Button>
            </div>
          </div>
        )}
        {/* Only a question while phrases are allowed, and only bites with a letter set. */}
        {multiWord && (
          <>
            <span className="sb-fieldlabel" id="sb-every-word">
              Which words need the letter?
            </span>
            <div className="sb-seg" role="group" aria-labelledby="sb-every-word" style={s.letter ? undefined : { opacity: 0.45 }}>
              <button type="button" aria-pressed={!everyWord} disabled={working || !s.letter} onClick={() => pickEveryWord(false)}>
                Just the first
              </button>
              <button type="button" aria-pressed={everyWord} disabled={working || !s.letter} onClick={() => pickEveryWord(true)}>
                Every word
              </button>
            </div>
            <p style={{ margin: 0, fontSize: "0.92rem" }}>
              {!s.letter
                ? "Pick a starting letter first. Without one this changes nothing."
                : everyWord
                  ? examples
                    ? `Every word starts with ${s.letter}: ${examples[0]} works, ${examples[1]} does not.`
                    : `Every word in an entry has to start with ${s.letter}.`
                  : examples
                    ? `Only the first letter counts: ${examples[1]} works for ${s.letter}.`
                    : `Only the first letter of an entry has to be ${s.letter}.`}
            </p>
            {askWords === "every" && s.letter && !everyWord && (
              <div className="sb-pop" role="alert" style={CONFIRM_BOX}>
                <p className="sb-cond" style={{ margin: 0, fontSize: "1.05rem" }}>
                  Switch to every word?
                </p>
                <p style={{ margin: 0, fontSize: "0.95rem" }}>
                  Words are already in the bowl. Any with a word that does not start with {s.letter} get handed back to whoever wrote them to
                  write again.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button size="sm" variant="pink" disabled={working} onClick={confirmWords}>
                    Yes, every word
                  </Button>
                  <Button size="sm" variant="paper" disabled={working} onClick={() => setAskWords(null)}>
                    Keep just the first
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── proper nouns ── */}
      <Section
        title="Proper nouns"
        note={
          noProperNouns
            ? "No names of people, places, brands or titles. Everyday things only."
            : "Names, places and titles are fair game."
        }
      >
        <div className="sb-seg" role="group" aria-label="Proper nouns">
          <button type="button" aria-pressed={!noProperNouns} disabled={working} onClick={() => pickProperNouns(false)}>
            Allowed
          </button>
          <button type="button" aria-pressed={noProperNouns} disabled={working} onClick={() => pickProperNouns(true)}>
            No proper nouns
          </button>
        </div>
        {/* The game never checks words against this rule, so nothing is thrown out. */}
        {noProperNouns && wordsExist && (
          <p style={{ margin: 0, fontSize: "0.92rem" }}>Words already written stay. Ask anyone who used a name to swap it.</p>
        )}
      </Section>

      {/* ── idea machine ── */}
      {/* Word ideas for players only: the theme ideas button above always works. */}
      <Section
        title="Idea machine"
        note={
          aiHelper
            ? "Players who are stuck can tap Get ideas for word suggestions."
            : "No AI help. Everyone comes up with their own words."
        }
      >
        <div className="sb-seg" role="group" aria-label="Idea machine for players">
          <button type="button" aria-pressed={aiHelper} disabled={working} onClick={() => void save({ aiHelper: true })}>
            On
          </button>
          <button type="button" aria-pressed={!aiHelper} disabled={working} onClick={() => void save({ aiHelper: false })}>
            Off
          </button>
        </div>
      </Section>

      {/* ── words per player ── */}
      <Section title="Words per player" note="How many words each person writes. Lowering it throws out the extra words people already wrote.">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <IconButton label="One word fewer" disabled={working || s.wordsPerPlayer <= 1} onClick={() => void save({ wordsPerPlayer: s.wordsPerPlayer - 1 })}>
            <Minus size={22} strokeWidth={3} />
          </IconButton>
          <span className="sb-display" style={{ fontSize: "2.6rem", minWidth: "1.4em", textAlign: "center" }} aria-live="polite">
            {s.wordsPerPlayer}
          </span>
          <IconButton label="One word more" disabled={working || s.wordsPerPlayer >= 10} onClick={() => void save({ wordsPerPlayer: s.wordsPerPlayer + 1 })}>
            <Plus size={22} strokeWidth={3} />
          </IconButton>
          <span className="sb-cond">each</span>
        </div>
      </Section>

      {/* ── turn length ── */}
      <Section title="Turn length" note="Seconds on the clock for each turn.">
        <div className="sb-seg">
          {TURN_LENGTHS.map((secs) => (
            <button
              key={secs}
              type="button"
              aria-pressed={s.turnSeconds === secs}
              aria-label={`${secs} seconds`}
              disabled={working}
              onClick={() => void save({ turnSeconds: secs })}
            >
              {secs}s
            </button>
          ))}
        </div>
      </Section>

      {/* ── skip rule ── */}
      <Section title="Skipping" note={SKIP_RULES[s.skipRule].detail}>
        <div className="sb-seg">
          {SKIP_ORDER.map((rule) => (
            <button key={rule} type="button" aria-pressed={s.skipRule === rule} disabled={working} onClick={() => void save({ skipRule: rule })}>
              {SKIP_RULES[rule].name}
            </button>
          ))}
        </div>
      </Section>

      {/* ── carry-over ── */}
      <Section
        title="Leftover time"
        note={
          s.carryOver
            ? "Empty the bowl with time to spare and you keep those seconds to open the next set."
            : "Empty the bowl and your turn is over. The next team opens the next set."
        }
      >
        <div className="sb-seg" role="group" aria-label="Carry leftover time into the next set">
          <button type="button" aria-pressed={s.carryOver} disabled={working} onClick={() => void save({ carryOver: true })}>
            Carries over
          </button>
          <button type="button" aria-pressed={!s.carryOver} disabled={working} onClick={() => void save({ carryOver: false })}>
            Use it or lose it
          </button>
        </div>
      </Section>

      {/* ── teams ── */}
      <Section title="Teams" note="How many teams, and what they are called. Drop a team and its players get dealt into the others.">
        <div className="sb-seg">
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" aria-pressed={s.teams.length === n} aria-label={`${n} teams`} disabled={working} onClick={() => setTeamCount(n)}>
              {n} teams
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {s.teams.map((team, i) => (
            <div key={i} data-team={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, borderLeft: "10px solid var(--sb-team)", borderRadius: 14 }}>
                <DraftInput
                  value={team.name}
                  maxLength={24}
                  placeholder={`Team ${i + 1}`}
                  label={`Name of team ${i + 1}`}
                  compact
                  onCommit={(name) => renameTeam(i, name, true)}
                />
              </div>
              {/* Not tied to "working": it is often tapped straight from the name field. */}
              <IconButton label={`Roll a random band name for team ${i + 1}`} onClick={() => rollName(i)}>
                <Dices size={22} />
              </IconButton>
            </div>
          ))}
        </div>
      </Section>

      <Button onClick={onClose}>Done</Button>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h3 className="sb-card-title" style={{ margin: 0 }}>
          {title}
        </h3>
        {note && <p style={{ margin: "4px 0 0", fontSize: "0.92rem", opacity: 0.75 }}>{note}</p>}
      </div>
      {children}
    </section>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="sb-iconbtn"
      style={{ background: "#fff", flex: "none", opacity: disabled ? 0.35 : 1 }}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/**
 * A text field that shows the server's value until you type, then keeps your
 * draft and commits it on blur or Enter.
 */
function DraftInput({
  value,
  maxLength,
  placeholder,
  label,
  compact,
  onCommit,
}: {
  value: string
  maxLength: number
  placeholder: string
  label: string
  compact?: boolean
  onCommit: (next: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<string | null>(null)

  async function commit() {
    if (draft === null) return
    const next = draft.trim()
    if (next !== value) await onCommit(next)
    // Back to showing the server's value (which now includes the change).
    setDraft(null)
  }

  return (
    <input
      className="sb-input"
      style={compact ? { fontSize: "1.15rem", minHeight: 48 } : undefined}
      value={draft ?? value}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}
