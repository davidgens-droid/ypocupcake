"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Ear, EarOff, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

// ─── Web Speech (recognition) — same minimal subset the other voice UIs use ──
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

// ─── The on/off flag, per meeting, per device ────────────────────────────────
// Scoped to the meeting so every meeting starts OFF: a flag that quietly
// carried over would mean future presenters get transcribed without anyone
// having decided that today. Read through useSyncExternalStore so the server
// render (false) and the first client render agree, and the stored value
// takes over without an effect.
const flagKey = (meetingId: string) => `cupcake.listeningMode.${meetingId}`
const flagListeners = new Set<() => void>()
function subscribeFlag(cb: () => void) {
  flagListeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    flagListeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function readFlag(meetingId: string) {
  try {
    return localStorage.getItem(flagKey(meetingId)) === "1"
  } catch {
    return false
  }
}
function writeFlag(meetingId: string, on: boolean) {
  try {
    localStorage.setItem(flagKey(meetingId), on ? "1" : "0")
  } catch {
    // private mode etc. — the switch still works for this page load
  }
  flagListeners.forEach((cb) => cb())
}
const noSubscribe = () => () => {}

// Anything shorter is a cough or a false start — not worth a round-trip.
const MIN_CHARS = 40
// A recognizer session that dies this fast, this often, is broken (Brave,
// offline, another recognizer holding the mic) — stop and say so instead of
// spinning forever behind a "Listening…" status.
const FLAP_MS = 1000
const MAX_FLAPS = 5

/**
 * Ask for the microphone inside the user's click on the toggle, so the
 * permission prompt appears now — not mid-update at the first reveal, where a
 * delayed "Allow" would silently lose the start of someone's words. The
 * tracks are released immediately; recognition opens its own.
 */
function warmUpMicrophone() {
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
}

function countWords(s: string) {
  return s ? s.split(/\s+/).filter(Boolean).length : 0
}

type Props = {
  meetingId: string
  /** Who is presenting right now; null while nobody is up. */
  presenterId: string | null
  presenterName: string | null
  /**
   * Set when the current round isn't one listening mode applies to (an
   * exploration, commitments, lightning…). The switch stays visible so the
   * moderator can see it's on, but nothing is recorded until an updates or
   * experience-sharing round starts.
   */
  pausedLabel?: string
  /**
   * Called once per presenter, with everything heard, the moment their turn
   * ends (next reveal, round end, cancel, or navigating within the app).
   * Switching listening mode OFF mid-update DISCARDS what was heard — "off"
   * must mean nothing leaves the device — and so does closing or reloading
   * the tab (there is no unload hook on purpose). The text lives only in
   * memory.
   */
  onFlush: (presenterId: string, transcript: string) => void
}

type ErrState = { presenterId: string; message: string }

/**
 * Listening mode for the moderator's device. While on and someone is
 * presenting, the browser's speech recognition runs and the words accumulate
 * in a ref — never in state, never on disk. When the presenter changes the
 * accumulated text is handed to `onFlush` exactly once and dropped.
 */
export function ListeningModePanel({
  meetingId,
  presenterId,
  presenterName,
  pausedLabel,
  onFlush,
}: Props) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => !!getSpeechRecognitionCtor(),
    () => false
  )
  const enabled = useSyncExternalStore(
    subscribeFlag,
    () => readFlag(meetingId),
    () => false
  )

  const [heard, setHeard] = useState<{ presenterId: string; words: number } | null>(null)
  // Scoped to a presenter so a failure during A's turn can't sit, red, over
  // B's working recognizer.
  const [errState, setErrState] = useState<ErrState | null>(null)

  const onFlushRef = useRef(onFlush)
  useEffect(() => {
    onFlushRef.current = onFlush
  })
  const finalsRef = useRef("")
  const interimRef = useRef("")
  // Re-spawns the recognizer in place after a failure, keeping what was heard.
  const retryRef = useRef<(() => void) | null>(null)

  const active = enabled && supported && !!presenterId && !pausedLabel

  useEffect(() => {
    if (!active || !presenterId) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return

    const presenter = presenterId
    let stopped = false
    let rec: SpeechRecognitionInstance | null = null
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let releaseLock: (() => void) | null = null
    let sessionStartedAt = 0
    let flaps = 0
    finalsRef.current = ""
    interimRef.current = ""

    const fail = (message: string) => {
      stopped = true
      setErrState({ presenterId: presenter, message })
    }

    const spawn = () => {
      const r = new Ctor()
      r.continuous = true
      r.interimResults = true
      r.lang = "en-US"
      sessionStartedAt = new Date().getTime()
      r.onresult = (event) => {
        let fin = ""
        let inter = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i]
          if (res.isFinal) fin += res[0].transcript
          else inter += res[0].transcript
        }
        if (fin) finalsRef.current = (finalsRef.current + " " + fin).trim()
        interimRef.current = inter
        flaps = 0
        // Words arriving means a transient error (network) has recovered.
        setErrState(null)
        setHeard({ presenterId: presenter, words: countWords(finalsRef.current) })
      }
      r.onend = () => {
        if (stopped) return
        // Browsers end continuous recognition on their own (silence, ~60s on
        // some Android builds). Keep going until the turn is over — unless
        // the session keeps dying instantly, which means it never worked.
        const lived = new Date().getTime() - sessionStartedAt
        if (lived < FLAP_MS && ++flaps >= MAX_FLAPS) {
          fail("Speech recognition keeps stopping (this browser may not support it, or the service is unreachable). What was heard so far is kept — tap Retry, or try Chrome, Edge or Safari.")
          return
        }
        restartTimer = setTimeout(() => {
          restartTimer = null
          if (stopped) return
          try {
            spawn()
          } catch {
            fail("Voice input couldn't restart. What was heard so far is kept — tap Retry.")
          }
        }, 300)
      }
      r.onerror = (event) => {
        const code = event.error
        if (code === "not-allowed" || code === "service-not-allowed") {
          fail("Microphone access denied. Allow it in your browser, then tap Retry.")
        } else if (code === "audio-capture") {
          fail("No microphone found on this device. Connect one, then tap Retry.")
        } else if (code === "aborted") {
          // We never call abort(): another tab or app on this device took the
          // recognition session. Restarting would just ping-pong with it.
          fail("Another tab or app on this device is using speech recognition. Close it, then tap Retry.")
        } else if (code === "network") {
          setErrState({ presenterId: presenter, message: "Speech service unreachable — retrying. What was heard so far is kept." })
        }
        // "no-speech": onend fires next and the restart logic decides.
      }
      rec = r
      try {
        r.start()
      } catch {
        // start() throwing synchronously means recognition is unavailable
        // right now (another recognizer holds the mic, or the browser refused)
        // — say so rather than show "Listening…" over silence.
        fail("Voice input couldn't start. Close other tabs using the microphone, then tap Retry.")
      }
    }

    // One listener per device per meeting: a second runner tab would abort
    // this one's session (Chromium runs one recognition at a time).
    const lockName = `cupcake.listening.${meetingId}`
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined
    if (locks) {
      const held = new Promise<void>((resolve) => {
        releaseLock = resolve
      })
      locks
        .request(lockName, { ifAvailable: true }, (lock) => {
          if (!lock) {
            fail("Another tab on this device is already listening for this meeting. Close it (or tap Retry to listen from here).")
            return Promise.resolve()
          }
          if (!stopped) spawn()
          return held
        })
        .catch(() => {
          if (!stopped) spawn()
        })
    } else {
      spawn()
    }

    retryRef.current = () => {
      stopped = false
      flaps = 0
      setErrState(null)
      spawn()
    }

    return () => {
      stopped = true
      retryRef.current = null
      if (restartTimer) clearTimeout(restartTimer)
      releaseLock?.()
      if (rec) {
        rec.onend = null
        rec.onresult = null
        rec.onerror = null
        try {
          rec.stop()
        } catch {
          // ignore
        }
      }
      const text = (finalsRef.current + " " + interimRef.current).trim()
      finalsRef.current = ""
      interimRef.current = ""
      // The moderator switching listening OFF is the one reason this cleanup
      // runs where nothing may leave the device. Every other reason (next
      // presenter, round over, leaving the page) hands the text over.
      if (!readFlag(meetingId)) return
      if (text.length >= MIN_CHARS) onFlushRef.current(presenter, text)
    }
  }, [active, presenterId, meetingId])

  const firstName = presenterName?.split(" ")[0] ?? null
  const words = heard && heard.presenterId === presenterId ? heard.words : 0
  const error = errState && errState.presenterId === presenterId ? errState.message : null

  const status = !supported
    ? "Not supported in this browser — use Chrome, Edge or Safari."
    : error
      ? error
      : !enabled
        ? "Off."
        : pausedLabel
          ? `Paused during ${pausedLabel} — resumes for updates and experience sharing.`
          : !presenterId
            ? "On — starts listening when someone is revealed."
            : `Listening to ${firstName ?? "the presenter"}… ${words} word${words === 1 ? "" : "s"} heard.`

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          active && !error ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        {active && !error ? <Ear className="size-4 animate-pulse" /> : <EarOff className="size-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="listening-mode" className="text-sm font-medium">
            Listening mode
          </Label>
          <Switch
            id="listening-mode"
            checked={enabled}
            disabled={!supported}
            onCheckedChange={(on) => {
              setErrState(null)
              setHeard(null)
              if (on) warmUpMicrophone()
              writeFlag(meetingId, on)
            }}
          />
        </div>
        <p
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
        {error && active && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => retryRef.current?.()}
          >
            <RotateCcw className="size-3" /> Retry
          </Button>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          After each update, Claude lists potential parking-lot topics for you to
          review later. Cupcake never writes down or records what&apos;s said: the
          words stay in this browser until the update ends, are sent once to
          Claude (Anthropic&apos;s API, which doesn&apos;t train on them and keeps
          inputs for up to 30 days under its policy), and only the suggested
          topics are saved. Switching off mid-update discards what was heard,
          unsent. Leaving this screen sends what was heard so far; closing the
          tab discards it. Off by default for every meeting. Uses your
          browser&apos;s speech service (Google on Chrome, Microsoft on Edge, Apple
          on Safari). Let the forum know when it&apos;s on.
        </p>
      </div>
    </div>
  )
}
