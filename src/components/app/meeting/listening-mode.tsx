"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Ear, EarOff } from "lucide-react"

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

// ─── The on/off flag, persisted per device ───────────────────────────────────
// Read through useSyncExternalStore so the server render (false) and the first
// client render agree, and the stored value takes over without an effect.
const STORAGE_KEY = "cupcake.listeningMode"
const flagListeners = new Set<() => void>()
function subscribeFlag(cb: () => void) {
  flagListeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    flagListeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function readFlag() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}
function writeFlag(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0")
  } catch {
    // private mode etc. — the switch still works for this page load
  }
  flagListeners.forEach((cb) => cb())
}
const noSubscribe = () => () => {}

// Anything shorter is a cough or a false start — not worth a round-trip.
const MIN_CHARS = 40

function countWords(s: string) {
  return s ? s.split(/\s+/).filter(Boolean).length : 0
}

type Props = {
  /** Who is presenting right now; null while nobody is up. */
  presenterId: string | null
  presenterName: string | null
  /**
   * Called once per presenter, with everything heard, the moment their turn
   * ends (next reveal, round end, cancel, listening switched off, or the page
   * closing). The text lives only in memory until then.
   */
  onFlush: (presenterId: string, transcript: string) => void
}

/**
 * Listening mode for the moderator's device. While on and someone is
 * presenting, the browser's speech recognition runs and the words accumulate
 * in a ref — never in state, never on disk. When the presenter changes the
 * accumulated text is handed to `onFlush` exactly once and dropped.
 */
export function ListeningModePanel({ presenterId, presenterName, onFlush }: Props) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => !!getSpeechRecognitionCtor(),
    () => false
  )
  const enabled = useSyncExternalStore(subscribeFlag, readFlag, () => false)

  const [heard, setHeard] = useState<{ presenterId: string; words: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFlushRef = useRef(onFlush)
  useEffect(() => {
    onFlushRef.current = onFlush
  })
  const finalsRef = useRef("")
  const interimRef = useRef("")

  const active = enabled && supported && !!presenterId

  useEffect(() => {
    if (!active || !presenterId) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return

    const presenter = presenterId
    let stopped = false
    let rec: SpeechRecognitionInstance | null = null
    finalsRef.current = ""
    interimRef.current = ""

    const spawn = () => {
      const r = new Ctor()
      r.continuous = true
      r.interimResults = true
      r.lang = "en-US"
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
        setHeard({ presenterId: presenter, words: countWords(finalsRef.current) })
      }
      r.onend = () => {
        // Browsers end continuous recognition on their own (silence, ~60s on
        // some Android builds). Keep going until the turn is over.
        if (!stopped) {
          try {
            spawn()
          } catch {
            // give up quietly; the status line still shows what was heard
          }
        }
      }
      r.onerror = (event) => {
        const code = event.error
        if (code === "not-allowed" || code === "service-not-allowed") {
          stopped = true
          setError("Microphone access denied. Allow it in your browser, then switch listening mode off and on.")
        } else if (code === "audio-capture") {
          stopped = true
          setError("No microphone found on this device.")
        } else if (code === "network") {
          setError("Speech service unreachable — retrying.")
        }
        // "no-speech" / "aborted": onend fires next and restarts.
      }
      rec = r
      try {
        r.start()
      } catch {
        // already started
      }
    }
    spawn()

    return () => {
      stopped = true
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
      if (text.length >= MIN_CHARS) onFlushRef.current(presenter, text)
    }
  }, [active, presenterId])

  const firstName = presenterName?.split(" ")[0] ?? null
  const words = heard && heard.presenterId === presenterId ? heard.words : 0

  const status = !supported
    ? "Not supported in this browser — use Chrome, Edge or Safari."
    : error
      ? error
      : !enabled
        ? "Off."
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
              setError(null)
              writeFlag(on)
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
        <p className="text-[11px] leading-snug text-muted-foreground">
          After each update, Claude lists potential parking-lot topics for you to
          review later. Nothing is written down or recorded: the words stay in
          this browser until the update ends, go to Claude once, and are
          discarded. Uses your browser&apos;s speech recognition (on Chrome,
          Google&apos;s service).
        </p>
      </div>
    </div>
  )
}
