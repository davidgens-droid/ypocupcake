"use client"

// Salad Bowl — the lobby's main job: writing your words (and an idea
// machine for when the mind goes blank).
import { useRef, useState, type FormEvent } from "react"
import { Lightbulb, Plus, X } from "lucide-react"

import { errorText, fetchIdeas } from "@/lib/saladbowl/api"

import type { ScreenProps } from "./props"
import { Button, Card, Label, Marker, Stamp, toast } from "./ui"

export function LobbyWords({ store, snap, state }: ScreenProps) {
  const [text, setText] = useState("")
  // n changes on every failure so the message re-pops even for the same error.
  const [error, setError] = useState<{ text: string; n: number } | null>(null)
  // A batch only fits the theme, letter, proper-noun and word-shape rules it was asked under.
  const [ideas, setIdeas] = useState<{ list: string[]; theme: string; letter: string; noProperNouns: boolean; multiWord: boolean; everyWord: boolean }>({
    list: [],
    theme: "",
    letter: "",
    noProperNouns: false,
    multiWord: true,
    everyWord: false,
  })
  const [ideasBusy, setIdeasBusy] = useState(false)
  const [ideasError, setIdeasError] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)

  const me = state.me
  if (!me) return null

  const per = state.settings.wordsPerPlayer
  const letter = state.settings.letter
  // Games made before this rule existed carry no value: only true is "on".
  const noProperNouns = state.settings.noProperNouns === true
  // The host's idea machine switch. Old games carry no value and it is allowed
  // in them: only false is "off".
  const aiHelper = state.settings.aiHelper !== false
  // Phrases are allowed unless the host said otherwise (old games carry no
  // value): only false is "one word only". "Every word on the letter" is only
  // true when the host switched it on; it is in force with phrases allowed and
  // a letter set.
  const multiWord = state.settings.multiWord !== false
  const everyWord = state.settings.everyWord === true
  const wordRule = !multiWord ? "One word only tonight, no spaces." : everyWord && letter ? `Every word has to start with ${letter}.` : null
  const count = me.words.length
  const full = count >= per
  const adding = snap.pending === "word:add"
  const removing = snap.pending === "word:remove"
  const hostName = state.players.find((p) => p.host)?.name ?? "the host"
  const mine = new Set(me.words.map((w) => w.text.trim().toLowerCase()))
  const ideasFit =
    ideas.theme === state.settings.theme &&
    ideas.letter === letter &&
    ideas.noProperNouns === noProperNouns &&
    ideas.multiWord === multiWord &&
    ideas.everyWord === everyWord
  // No chips at all while the host has the idea machine switched off.
  const shownIdeas = aiHelper && ideasFit ? ideas.list.filter((idea) => !mine.has(idea.trim().toLowerCase())) : []

  /** Restart the shake on the text field without remounting it (keeps focus). */
  function shakeField() {
    const el = fieldRef.current
    if (!el) return
    el.classList.remove("sb-shake")
    void el.offsetWidth
    el.classList.add("sb-shake")
  }

  async function add(value: string): Promise<{ ok: boolean; code?: string }> {
    const res = await store.addWord(value)
    if (!res.ok) {
      const message = errorText(res.error)
      setError((prev) => ({ text: message, n: (prev?.n ?? 0) + 1 }))
      shakeField()
      return { ok: false, code: res.error }
    }
    setError(null)
    return { ok: true }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    inputRef.current?.focus()
    const value = text.trim()
    if (!value || adding) return
    // Clear straight away so the next word can be typed while this one lands.
    setText("")
    const res = await add(value)
    if (!res.ok) setText((current) => current || value)
  }

  async function remove(wordId: string) {
    const res = await store.removeWord(wordId)
    if (!res.ok) setError((prev) => ({ text: errorText(res.error), n: (prev?.n ?? 0) + 1 }))
    else setError(null)
  }

  async function getIdeas() {
    const token = snap.seat?.token
    if (!token) {
      setIdeasError(errorText("no_seat"))
      return
    }
    setIdeasBusy(true)
    setIdeasError(null)
    const forTheme = state.settings.theme
    const forLetter = state.settings.letter
    const forNoProperNouns = noProperNouns
    const forMultiWord = multiWord
    const forEveryWord = everyWord
    const res = await fetchIdeas(state.code, token, "words")
    setIdeasBusy(false)
    // The host switched the idea machine off while this was in the air: the
    // button is already gone, and nothing from this request is shown or kept.
    if (store.getSnapshot().state?.settings.aiHelper === false) return
    if (!res.ok && res.error === "helper_off") {
      // Switched off a moment ago and this screen had not caught up: say so,
      // then fetch the game again so the button goes away.
      toast(errorText(res.error))
      void store.refresh()
      return
    }
    setAsked(true)
    if (!res.ok) {
      setIdeasError(errorText(res.error))
      return
    }
    setIdeas({
      list: Array.isArray(res.ideas) ? res.ideas.filter((x) => typeof x === "string" && x.trim() !== "") : [],
      theme: forTheme,
      letter: forLetter,
      noProperNouns: forNoProperNouns,
      multiWord: forMultiWord,
      everyWord: forEveryWord,
    })
  }

  async function pickIdea(idea: string) {
    const res = await add(idea)
    // Taken (or just added): either way that chip has done its job.
    if (res.ok || res.code === "duplicate") setIdeas((cur) => ({ ...cur, list: cur.list.filter((x) => x !== idea) }))
  }

  return (
    <Card bar="pink">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 className="sb-card-title" style={{ margin: 0, fontSize: "1.8rem" }}>
          Your words
        </h2>
        <Label tone={full ? undefined : "yellow"}>
          {count} of {per}
        </Label>
      </div>

      <div style={{ display: "flex", gap: 5, margin: "10px 0 14px" }} aria-hidden>
        {Array.from({ length: per }, (_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 9,
              border: "2px solid var(--sb-ink)",
              borderRadius: 3,
              background: i < count ? "var(--sb-pink)" : "transparent",
            }}
          />
        ))}
      </div>

      {full ? (
        <div className="sb-pop" style={{ display: "flex", alignItems: "center", gap: 16, padding: "4px 0 8px" }}>
          <Stamp tone="green">All in</Stamp>
          <p style={{ margin: 0, flex: 1 }}>
            Sit tight. {hostName === me.name ? "Start the show when the room is ready." : `${hostName} starts the show when the room is ready.`}
          </p>
        </div>
      ) : (
        <>
          <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <div ref={fieldRef} style={{ flex: 1, minWidth: 0 }}>
              <input
                ref={inputRef}
                className="sb-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={40}
                placeholder={letter ? `Starts with ${letter}` : multiWord ? "Type a word" : "Type one word"}
                aria-label={`Word ${count + 1} of ${per}`}
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="done"
              />
            </div>
            {/* preventDefault on mouse down keeps the keyboard up while tapping ADD */}
            <Button type="submit" inline disabled={adding} onMouseDown={(e) => e.preventDefault()}>
              <Plus size={20} strokeWidth={3} /> Add
            </Button>
          </form>
          <p style={{ margin: "10px 0 0", fontSize: "0.95rem" }}>
            {/* The rule the game enforces comes first, in bold; the rest is advice. */}
            {wordRule && <b>{wordRule}</b>}
            {wordRule && " "}
            {noProperNouns ? "Everyday things only: no names of people, places, brands or titles." : "Names, places, things."} Pick something your
            team can guess, act out, and sum up in one word.
          </p>
        </>
      )}

      {error && (
        <div key={error.n} className="sb-error sb-pop" role="alert" style={{ marginTop: 10 }}>
          {error.text}
        </div>
      )}

      {count > 0 && (
        <ol className="sb-setlist" style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
          {me.words.map((w, i) => (
            <li key={w.id} className="sb-row sb-rise">
              <span className="sb-row-key" style={{ minWidth: 20 }}>
                {i + 1}
              </span>
              <span className="sb-row-title sb-row-grow" style={{ overflowWrap: "anywhere" }}>
                {w.text}
              </span>
              <button type="button" className="sb-iconbtn" aria-label={`Remove ${w.text}`} disabled={removing} onClick={() => remove(w.id)}>
                <X size={20} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <p style={{ margin: "10px 0 0" }}>
        <Marker tone="blue" arrow="left">
          {full ? "changed your mind? remove one and write another" : "only you can see these"}
        </Marker>
      </p>

      {!full && !aiHelper && (
        <p style={{ borderTop: "2px dashed rgba(12,12,14,.3)", margin: "14px 0 0", paddingTop: 14, fontSize: "0.95rem" }}>
          {me.host
            ? "No idea machine tonight. It is switched off in Set list & rules, so everyone brings their own words."
            : `No idea machine tonight: ${hostName} wants your own words.`}
        </p>
      )}

      {!full && aiHelper && (
        <div style={{ borderTop: "2px dashed rgba(12,12,14,.3)", marginTop: 14, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span className="sb-cond" style={{ fontSize: "1.1rem" }}>
              Stuck?
            </span>
            <Button size="sm" variant="cyan" disabled={ideasBusy} onClick={getIdeas}>
              <Lightbulb size={18} /> {ideasBusy ? "Thinking" : asked ? "Fresh ideas" : "Get ideas"}
            </Button>
          </div>
          {ideasError && (
            <div className="sb-error" role="alert">
              {ideasError}
            </div>
          )}
          {shownIdeas.length > 0 && (
            <>
              <p style={{ margin: 0, fontSize: "0.92rem" }}>Tap one to drop it in the bowl.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {shownIdeas.map((idea) => (
                  <button key={idea} type="button" className="sb-chip sb-rise" style={{ minHeight: 44 }} disabled={adding} onClick={() => pickIdea(idea)}>
                    <Plus size={16} strokeWidth={3} />
                    <span>{idea}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {asked && !ideasBusy && !ideasError && shownIdeas.length === 0 && (
            <p style={{ margin: 0, fontSize: "0.92rem" }}>Nothing left on that list. Ask again for a fresh batch.</p>
          )}
        </div>
      )}
    </Card>
  )
}
