"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { generateUpdateFromBrainDump } from "@/lib/ai/brain-dump"
import { interviewTurn } from "@/lib/ai/interview"
import {
  COVERAGE_SECTIONS,
  EMPTY_COVERAGE,
  type InterviewAction,
  type InterviewCoverage,
  type InterviewMessage,
} from "@/lib/ai/interview-types"
import type { UpdateContent } from "@/lib/updates/schema"

// ─── Web Speech (recognition) — minimal types, same subset the dialog uses ──
type SpeechRecognitionEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}
type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance
function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

/**
 * Prefer a natural, LOCAL English voice. Chrome's remote "Google …" voices
 * stop producing audio after ~15s and never fire onend, which would cut long
 * questions mid-sentence — so they're only a last resort.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!ttsAvailable()) return null
  const voices = window.speechSynthesis.getVoices()
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang))
  const local = en.filter((v) => v.localService)
  const prefer = ["Samantha", "Microsoft Aria", "Microsoft Jenny", "Karen", "Daniel", "Moira", "Alex"]
  for (const pool of [local, en]) {
    for (const p of prefer) {
      const v = pool.find((x) => x.name.includes(p))
      if (v) return v
    }
    if (pool.length > 0) return pool[0]
  }
  return voices[0] ?? null
}

function recognizerErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access denied. Allow it in your browser settings, then tap Retry."
    case "audio-capture":
      return "No microphone was found. Plug one in or check your input device, then tap Retry."
    case "network":
      return "Speech recognition couldn't reach its service. Check your connection (some browsers, like Brave, don't support it), then tap Retry."
    case "language-not-supported":
      return "Speech recognition doesn't support English on this device."
    default:
      return `Voice input stopped (${code ?? "unknown error"}). Tap Retry.`
  }
}

// After the member stops talking, how long before we treat the answer as done.
// Pause keeps the answer, so this only has to cover a natural breath.
const SILENCE_MS = 4000
// If nothing has been heard at all for this long, show a gentle hint.
const HINT_MS = 10_000
// A recognizer session that dies this fast is flapping, not working.
const FLAP_MS = 1000
const MAX_FLAPS = 4

const GENERATING_MESSAGES = [
  "Reading through our conversation…",
  "Drafting feelings and situations…",
  "Going deeper on significance…",
  "Pulling your update together…",
]

type Phase =
  | "idle"
  | "thinking"
  | "speaking"
  | "listening"
  | "paused"
  | "generating"
  | "error"

type Props = {
  currentContent: UpdateContent
  /**
   * True when the member already has content: the interviewer starts from
   * the draft's gaps (or asks what to add) and the generator folds the
   * answers into the existing update instead of starting fresh.
   */
  refining: boolean
  onGenerated: (content: UpdateContent) => void
  onExit: () => void
  /** Lets the dialog block accidental Escape/backdrop closes mid-interview. */
  onActiveChange: (active: boolean) => void
}

/**
 * "Interview Me": the AI asks one spoken question at a time, the member
 * answers by voice, and the finished transcript is handed to the normal
 * (hardened) update generator in CREATE mode.
 *
 * Mic is never open while the AI is speaking, so it can't transcribe itself.
 * Every async continuation checks `stoppedRef` and an epoch so a late server
 * response can't act after the member has taken over.
 */
export function InterviewMode({
  currentContent,
  refining,
  onGenerated,
  onExit,
  onActiveChange,
}: Props) {
  // This component only mounts after a click inside the open dialog, so it is
  // never server-rendered — reading window in initialisers is safe.
  const [sttSupported] = useState(() => !!getSpeechRecognitionCtor())
  const [ttsSupported] = useState(() => ttsAvailable())

  const [phase, setPhase] = useState<Phase>("idle")
  const [transcript, setTranscript] = useState<InterviewMessage[]>([])
  const [currentQuestion, setCurrentQuestion] = useState("")
  const [lastAction, setLastAction] = useState<InterviewAction | null>(null)
  const [coverage, setCoverage] = useState<InterviewCoverage>(EMPTY_COVERAGE)
  const [answer, setAnswer] = useState("")
  const [interim, setInterim] = useState("")
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [genMsg, setGenMsg] = useState(GENERATING_MESSAGES[0])

  // Refs mirror state for use inside async callbacks / recognizer handlers.
  const transcriptRef = useRef<InterviewMessage[]>([])
  const answerRef = useRef("")
  const interimRef = useRef("")
  const mutedRef = useRef(false)
  const stoppedRef = useRef(false)
  const listeningRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const sessionStartedAt = useRef(0)
  const flapCount = useRef(0)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const speakGuard = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Resolves the in-flight speak() promise early (mute / stop / finish).
  const speakResolve = useRef<(() => void) | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  // Bumped whenever the member takes over (stop / finish / repeat / restart /
  // cancel) so a turn that was mid-await can't resume and change the phase.
  const epoch = useRef(0)

  // Latest props, readable from async continuations that may outlive the
  // render that started them (a server round-trip, a silence timer).
  const latest = useRef({ currentContent, refining, onGenerated, onExit, onActiveChange })
  useEffect(() => {
    latest.current = { currentContent, refining, onGenerated, onExit, onActiveChange }
  })

  const answered = transcript.filter((m) => m.role === "user").length
  const asked = transcript.filter((m) => m.role === "ai").length

  // All the handlers below are plain function declarations (hoisted, so they
  // can call each other in any order) that touch only refs, setState and
  // `latest` — so a closure captured by a timer or the recognizer can never
  // go stale in a way that matters.

  // ── timers ────────────────────────────────────────────────────────────────
  function clearSilence() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
    silenceTimer.current = null
  }
  function clearHint() {
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = null
  }
  function clearRestart() {
    if (restartTimer.current) clearTimeout(restartTimer.current)
    restartTimer.current = null
  }
  function armSilence() {
    clearSilence()
    silenceTimer.current = setTimeout(finishAnswer, SILENCE_MS)
  }
  function armHint() {
    clearHint()
    hintTimer.current = setTimeout(() => setShowHint(true), HINT_MS)
  }

  // ── text-to-speech ────────────────────────────────────────────────────────
  function cancelSpeech() {
    if (ttsAvailable()) window.speechSynthesis.cancel()
    // Not every browser fires onend after cancel() — resolve it ourselves.
    speakResolve.current?.()
  }

  function speak(text: string) {
    return new Promise<void>((resolve) => {
      if (mutedRef.current || !ttsAvailable()) return resolve()
      const synth = window.speechSynthesis
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      const v = pickVoice()
      if (v) u.voice = v
      u.rate = 1
      u.pitch = 1
      let done = false
      const finish = () => {
        if (done) return
        done = true
        if (speakGuard.current) clearTimeout(speakGuard.current)
        speakGuard.current = null
        if (speakResolve.current === finish) speakResolve.current = null
        resolve()
      }
      u.onend = finish
      u.onerror = finish
      speakResolve.current = finish
      // Some browsers never fire onend (or clip long utterances); never leave
      // the member stuck in "speaking". If the guard trips while audio is
      // still playing, cut it — the mic must never open over the AI's voice.
      speakGuard.current = setTimeout(
        () => {
          try {
            synth.cancel()
          } catch {
            // ignore
          }
          finish()
        },
        Math.min(30_000, 2000 + text.length * 95)
      )
      synth.speak(u)
    })
  }

  // ── speech-to-text ────────────────────────────────────────────────────────
  function stopListening() {
    listeningRef.current = false
    clearSilence()
    clearHint()
    clearRestart()
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      rec.onend = null
      rec.onresult = null
      rec.onerror = null
      try {
        rec.stop()
      } catch {
        // already stopped
      }
    }
  }

  function failListening(message: string) {
    stopListening()
    setError(message)
    retryRef.current = () => startListening({ keep: true })
    setPhase("error")
  }

  function spawnRecognition(Ctor: SpeechRecognitionCtor) {
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = "en-US"
    sessionStartedAt.current = new Date().getTime()
    rec.onresult = (event) => {
      let fin = ""
      let inter = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) fin += r[0].transcript
        else inter += r[0].transcript
      }
      if (fin) {
        answerRef.current = (answerRef.current + " " + fin).trim()
        setAnswer(answerRef.current)
      }
      interimRef.current = inter
      setInterim(inter)
      setShowHint(false)
      flapCount.current = 0
      clearHint()
      armSilence()
    }
    rec.onend = () => {
      recognitionRef.current = null
      if (!listeningRef.current || stoppedRef.current) return
      // The session ended on its own. If the member has already said
      // something, let the silence timer finish the answer instead of
      // reopening the mic (Android plays a tone on every restart, and ends
      // sessions on every pause).
      if (answerRef.current || interimRef.current) {
        if (!silenceTimer.current) armSilence()
        return
      }
      // Nothing heard yet: keep the mic open, but a session that dies
      // instantly over and over is a broken recognizer, not silence.
      const lived = new Date().getTime() - sessionStartedAt.current
      if (lived < FLAP_MS && ++flapCount.current >= MAX_FLAPS) {
        failListening("Voice input keeps stopping on this device. Check your microphone and connection, then tap Retry.")
        return
      }
      clearRestart()
      restartTimer.current = setTimeout(() => {
        restartTimer.current = null
        if (!listeningRef.current || stoppedRef.current) return
        try {
          spawnRecognition(Ctor)
        } catch {
          failListening("Voice input couldn't restart. Tap Retry.")
        }
      }, 300)
    }
    rec.onerror = (event) => {
      const code = event.error
      // "no-speech" / "aborted": onend fires next and the restart logic above
      // decides. Everything else is terminal for this session.
      if (code === "no-speech" || code === "aborted") return
      failListening(recognizerErrorMessage(code))
    }
    recognitionRef.current = rec
    try {
      rec.start()
    } catch {
      // already started
    }
  }

  /**
   * Open the mic. `keep` preserves whatever the member has already said for
   * this question (Resume after Pause, Repeat, Retry after a mic error); a new
   * question starts fresh.
   */
  function startListening(opts: { keep?: boolean } = {}) {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Try Chrome or Safari.")
      setPhase("error")
      return
    }
    if (!opts.keep) {
      answerRef.current = ""
      interimRef.current = ""
      setAnswer("")
      setInterim("")
    }
    setError(null)
    setShowHint(false)
    flapCount.current = 0
    listeningRef.current = true
    setPhase("listening")
    armHint()
    spawnRecognition(Ctor)
  }

  // ── the conversation ──────────────────────────────────────────────────────
  async function generate(base: InterviewMessage[]) {
    if (stoppedRef.current) return
    const myEpoch = epoch.current
    const superseded = () => stoppedRef.current || myEpoch !== epoch.current
    setPhase("generating")
    setError(null)
    const brainDump =
      (latest.current.refining
        ? `Interview transcript — the member is REFINING their existing update (the current draft). Fold what they say here into that draft: add, correct or deepen; keep everything else.\n`
        : `Interview transcript for the member's monthly update.\n`) +
      `Lines starting "Me:" are the member's own words. Lines starting "Interviewer:" are the AI's questions — prompts only, NOT the member's content.\n\n` +
      base
        .map((m) => `${m.role === "ai" ? "Interviewer" : "Me"}: ${m.text}`)
        .join("\n\n")
    let res: Awaited<ReturnType<typeof generateUpdateFromBrainDump>>
    try {
      res = await generateUpdateFromBrainDump({
        brainDump,
        existing: latest.current.currentContent,
      })
    } catch {
      // The Server Action itself rejected (connection dropped, a deploy
      // rotated the action id, the function was killed) — distinct from the
      // {ok:false} it returns for AI errors. Never leave the member stuck.
      if (superseded()) return
      setError("Lost the connection while building your update. Your answers are safe — tap Retry.")
      retryRef.current = () => void generate(base)
      setPhase("error")
      return
    }
    if (superseded()) return
    if (!res.ok) {
      setError(res.error)
      retryRef.current = () => void generate(base)
      setPhase("error")
      return
    }
    latest.current.onActiveChange(false)
    latest.current.onGenerated(res.content)
  }

  async function sendTurn(next: InterviewMessage[]) {
    if (stoppedRef.current) return
    const myEpoch = epoch.current
    const superseded = () => stoppedRef.current || myEpoch !== epoch.current
    setPhase("thinking")
    setError(null)
    let res: Awaited<ReturnType<typeof interviewTurn>>
    try {
      res = await interviewTurn({
        transcript: next,
        existing: latest.current.refining ? latest.current.currentContent : undefined,
      })
    } catch {
      if (superseded()) return
      setError("Lost the connection for a moment. Tap Retry to pick up where we were.")
      retryRef.current = () => void sendTurn(next)
      setPhase("error")
      return
    }
    if (superseded()) return
    if (!res.ok) {
      setError(res.error)
      retryRef.current = () => void sendTurn(next)
      setPhase("error")
      return
    }
    const { turn } = res
    setCoverage(turn.coverage)
    if (turn.action === "done") {
      // "Done" with nothing covered is the stop-with-no-content path (the
      // member said "stop" before saying anything substantive). Generating
      // from that would produce an empty update — treat it as a cancel.
      const nothingToBuild = Object.values(turn.coverage).every((v) => !v)
      if (nothingToBuild) {
        toast.info("Nothing to build an update from yet — no update was generated.")
        stopListening()
        latest.current.onActiveChange(false)
        setPhase("idle")
        return
      }
      await generate(next)
      return
    }
    const withQ: InterviewMessage[] = [...next, { role: "ai", text: turn.question }]
    transcriptRef.current = withQ
    setTranscript(withQ)
    setCurrentQuestion(turn.question)
    setLastAction(turn.action)
    setPhase("speaking")
    await speak(turn.question)
    if (superseded()) return
    startListening()
  }

  /** Take whatever has been heard for the current question and clear it. */
  function consumeAnswer(): string {
    const text = (answerRef.current + " " + interimRef.current).trim()
    answerRef.current = ""
    interimRef.current = ""
    setAnswer("")
    setInterim("")
    return text
  }

  function finishAnswer() {
    if (stoppedRef.current) return
    const text = consumeAnswer()
    if (!text) {
      toast.error("I didn't catch anything — try again, or tap Repeat to hear the question.")
      setShowHint(true)
      if (!listeningRef.current) startListening({ keep: true })
      return
    }
    stopListening()
    const next: InterviewMessage[] = [...transcriptRef.current, { role: "user", text }]
    transcriptRef.current = next
    setTranscript(next)
    void sendTurn(next)
  }

  function start() {
    if (!sttSupported) {
      toast.error("Voice input isn't supported in this browser. Try Chrome or Safari.")
      return
    }
    stoppedRef.current = false
    epoch.current++
    transcriptRef.current = []
    setTranscript([])
    setCoverage(EMPTY_COVERAGE)
    setCurrentQuestion("")
    setLastAction(null)
    setConfirmStop(false)
    onActiveChange(true)
    // Ask for the microphone now, inside the click, so the permission prompt
    // doesn't appear only after the first question has been spoken (and the
    // start of the first answer lost). The tracks are released immediately;
    // recognition opens its own.
    try {
      navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => {
          // surfaced later by the recognizer's own not-allowed path
        })
    } catch {
      // ignore
    }
    // Browsers (iOS especially) only allow speech after a user gesture. Say a
    // short line synchronously inside this click so later questions are
    // allowed to play.
    if (!mutedRef.current && ttsAvailable()) {
      try {
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("Let's begin."))
      } catch {
        // ignore
      }
    }
    void sendTurn([])
  }

  function stopNow() {
    stoppedRef.current = true
    epoch.current++
    cancelSpeech()
    stopListening()
    setConfirmStop(false)
    onActiveChange(false)
    onExit()
  }

  function requestStop() {
    // With answers on the table, a mis-tap next to the primary button would
    // throw away the whole conversation — confirm first.
    if (transcriptRef.current.some((m) => m.role === "user") || answerRef.current) {
      setConfirmStop(true)
      return
    }
    stopNow()
  }

  function finishAndGenerate() {
    // If the member is mid-answer, keep what they've said so far.
    const partial = consumeAnswer()
    const haveAnswer =
      transcriptRef.current.some((m) => m.role === "user") || partial.length > 0
    if (!haveAnswer) {
      toast.error("Answer at least one question first.")
      return
    }
    epoch.current++
    cancelSpeech()
    stopListening()
    setConfirmStop(false)
    const base: InterviewMessage[] = partial
      ? [...transcriptRef.current, { role: "user", text: partial }]
      : transcriptRef.current
    transcriptRef.current = base
    setTranscript(base)
    void generate(base)
  }

  /** Back out of a generation that's taking too long or was tapped by mistake. */
  function cancelGenerate() {
    epoch.current++
    setError(null)
    setPhase("paused")
  }

  async function repeat() {
    if (!currentQuestion) return
    epoch.current++
    const myEpoch = epoch.current
    cancelSpeech()
    stopListening()
    setPhase("speaking")
    await speak(currentQuestion)
    if (stoppedRef.current || myEpoch !== epoch.current) return
    startListening({ keep: true })
  }

  function togglePause() {
    if (phase === "listening") {
      stopListening()
      setPhase("paused")
    } else if (phase === "paused") {
      startListening({ keep: true })
    }
  }

  function toggleMute() {
    const next = !muted
    mutedRef.current = next
    setMuted(next)
    if (next && phase === "speaking") {
      // Muting mid-question: skip straight to listening.
      cancelSpeech()
    }
  }

  // Cycle the generating messages so the wait doesn't feel frozen.
  useEffect(() => {
    if (phase !== "generating") return
    let i = 0
    const id = setInterval(() => {
      i = (i + 1) % GENERATING_MESSAGES.length
      setGenMsg(GENERATING_MESSAGES[i])
    }, 2200)
    return () => clearInterval(id)
  }, [phase])

  // Chrome populates the voice list asynchronously; touching it once (and
  // listening for the change) means pickVoice() has real choices by the time
  // the first question is spoken instead of falling back to the default.
  useEffect(() => {
    if (!ttsAvailable()) return
    const synth = window.speechSynthesis
    synth.getVoices()
    const onChange = () => synth.getVoices()
    synth.addEventListener?.("voiceschanged", onChange)
    return () => synth.removeEventListener?.("voiceschanged", onChange)
  }, [])

  // Hard cleanup if the dialog unmounts us mid-interview: detach every
  // recognizer handler (a final result can arrive after stop() and would
  // otherwise re-arm the silence timer and fire a stray server turn).
  useEffect(() => {
    // Ref objects are stable; aliasing them here is what the hooks lint wants
    // for values read inside a cleanup.
    const stopped = stoppedRef
    const turnEpoch = epoch
    const guard = speakGuard
    return () => {
      stopped.current = true
      turnEpoch.current++
      if (guard.current) clearTimeout(guard.current)
      if (ttsAvailable()) window.speechSynthesis.cancel()
      stopListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── render ────────────────────────────────────────────────────────────────
  const firstQuestionPending = phase === "thinking" && asked === 0

  if (phase === "idle") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Sparkles className="size-4" /> How this works
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>I&apos;ll ask one question at a time, out loud. Just talk — I&apos;m listening.</li>
            <li>When you go quiet for a few seconds I&apos;ll move on, or tap <strong>Done answering</strong>. <strong>Pause</strong> holds the floor without losing what you&apos;ve said.</li>
            {refining ? (
              <li>I&apos;ll start from where your update stands — a gap if there is one, otherwise what you&apos;d like to add or change — and fold your answers into it. Usually just a few questions.</li>
            ) : (
              <li>I&apos;ll go for what&apos;s most alive this month — the highs, the lows, and why they matter.</li>
            )}
            <li>Say <em>&ldquo;that&apos;s enough&rdquo;</em> and I&apos;ll check whether to wrap up. Once you&apos;ve answered at least one question, <strong>Finish &amp; generate</strong> builds your update right away. <strong>Stop</strong> exits without generating.</li>
          </ul>
          {!sttSupported && (
            <p className="text-destructive">
              Voice input isn&apos;t supported in this browser. Try Chrome or Safari.
            </p>
          )}
          {!ttsSupported && (
            <p className="text-muted-foreground">
              This browser can&apos;t read questions aloud — they&apos;ll be shown as text.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={start} disabled={!sttSupported} className="gap-2">
            <Mic className="size-4" /> Start interview
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Back to typing
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1"
            onClick={toggleMute}
            disabled={!ttsSupported}
            aria-pressed={muted}
            aria-label={muted ? "Voice off — tap to turn on" : "Voice on — tap to mute"}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            {muted ? "Voice off" : "Voice on"}
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "generating") {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-4 py-8">
        <div className="relative">
          <Loader2 className="size-12 animate-spin text-muted-foreground" />
          <Sparkles className="absolute inset-0 m-auto size-5 text-foreground" />
        </div>
        <p key={genMsg} className="animate-in fade-in text-sm font-medium duration-500" role="status">
          {genMsg}
        </p>
        <p className="text-xs text-muted-foreground">
          {refining ? "Folding" : "Turning"} {answered} answer{answered === 1 ? "" : "s"} into your update. Usually 10–30s.
        </p>
        <Button variant="ghost" size="sm" onClick={cancelGenerate}>
          Cancel — back to the interview
        </Button>
      </div>
    )
  }

  const statusLabel =
    phase === "thinking"
      ? firstQuestionPending
        ? "Getting started…"
        : "Thinking…"
      : phase === "speaking"
        ? "Speaking…"
        : phase === "listening"
          ? "Listening…"
          : phase === "paused"
            ? "Paused"
            : "Needs attention"

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {/* status row */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium",
              phase === "listening" && "bg-emerald-100 text-emerald-900",
              phase === "speaking" && "bg-sky-100 text-sky-900",
              phase === "thinking" && "bg-muted text-muted-foreground",
              phase === "paused" && "bg-amber-100 text-amber-900",
              phase === "error" && "bg-destructive/10 text-destructive"
            )}
            role="status"
            aria-live="polite"
          >
            {phase === "listening" && <Mic className="size-3 animate-pulse" />}
            {phase === "thinking" && <Loader2 className="size-3 animate-spin" />}
            {phase === "speaking" && <Volume2 className="size-3" />}
            {phase === "paused" && <Pause className="size-3" />}
            {statusLabel}
          </span>
          <span className="text-muted-foreground">
            Q{Math.max(asked, 1)} · {answered} answered
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2"
            onClick={toggleMute}
            disabled={!ttsSupported}
            aria-pressed={muted}
            aria-label={muted ? "Voice is off — turn on" : "Voice is on — mute"}
            title={muted ? "Voice off — tap to turn on" : "Voice on — tap to mute"}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={() => void repeat()}
            disabled={!currentQuestion || phase === "thinking"}
            aria-label="Repeat the question"
            title="Repeat the question"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>

        {/* question — a live region so it is announced even when muted */}
        <div className="rounded-xl border bg-card p-4" aria-live="polite">
          {currentQuestion ? (
            <p className="font-heading text-lg leading-snug">{currentQuestion}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {firstQuestionPending ? "Thinking of a good place to start…" : "…"}
            </p>
          )}
          {lastAction === "ready" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Say anything else you&apos;d like included — or say &ldquo;go ahead&rdquo; / tap{" "}
              <strong>Finish &amp; generate</strong>.
            </p>
          )}
        </div>

        {/* answer */}
        {(phase === "listening" || phase === "paused") && (
          <div className="space-y-2">
            <div className="max-h-40 min-h-16 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
              {answer || interim ? (
                <>
                  {answer}
                  {interim && (
                    <span className="text-muted-foreground italic">
                      {answer ? " " : ""}
                      {interim}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {phase === "paused" ? "Paused — tap Resume to keep going." : "Go ahead, I'm listening…"}
                </span>
              )}
            </div>
            {showHint && phase === "listening" && (
              <p className="text-xs text-muted-foreground">
                Still here. Take your time — tap <strong>Done answering</strong> when you&apos;re
                finished, or <strong>Repeat</strong> to hear the question again.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={finishAnswer} className="gap-1">
                <Check className="size-4" /> Done answering
              </Button>
              <Button size="sm" variant="outline" onClick={togglePause} className="gap-1">
                {phase === "paused" ? (
                  <>
                    <Play className="size-4" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-4" /> Pause
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {phase === "error" && error && (
          <div
            className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            role="alert"
          >
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => retryRef.current?.()}>
              Retry
            </Button>
          </div>
        )}

        {/* coverage */}
        <div className="flex flex-wrap gap-1.5" aria-label="What the update has so far">
          {COVERAGE_SECTIONS.map((s) => (
            <span
              key={s.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                coverage[s.key]
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-border text-muted-foreground"
              )}
            >
              {coverage[s.key] && <Check className="size-3" aria-hidden />}
              {s.label}
              <span className="sr-only">{coverage[s.key] ? " — covered" : " — not yet"}</span>
            </span>
          ))}
        </div>

        {/* transcript */}
        {transcript.length > 0 && (
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
              Transcript ({transcript.length})
            </summary>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto border-t px-3 py-2 text-xs">
              {transcript.map((m, i) => (
                <li key={i} className={cn(m.role === "ai" ? "text-muted-foreground" : "")}>
                  <span className="font-medium">{m.role === "ai" ? "AI" : "You"}:</span> {m.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* footer controls — outside the scroll area so they're always reachable */}
      <div className="shrink-0 space-y-2 border-t pt-3">
        {confirmStop ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm"
            role="alertdialog"
            aria-label="Confirm stopping the interview"
          >
            <span>
              Discard {answered} answer{answered === 1 ? "" : "s"} and exit?
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>
                Keep going
              </Button>
              <Button size="sm" variant="destructive" onClick={stopNow}>
                Discard &amp; exit
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="ghost"
              onClick={requestStop}
              className="gap-1 text-destructive hover:bg-destructive/10"
            >
              <Square className="size-4" /> Stop
            </Button>
            <Button
              onClick={finishAndGenerate}
              disabled={answered === 0 && !(answer || interim)}
              className="gap-2"
            >
              <Sparkles className="size-4" /> Finish &amp; generate
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Privacy: processed by Claude. Anthropic doesn&apos;t train on your data. Only you ever
          see the result.
        </p>
      </div>
    </div>
  )
}
