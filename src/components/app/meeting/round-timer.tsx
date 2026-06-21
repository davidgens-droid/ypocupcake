"use client"

import { useEffect, useRef, useState } from "react"
import { Volume2, VolumeX } from "lucide-react"

import { cn } from "@/lib/utils"

type Props = {
  startedAt: string | null // ISO timestamp when the current member's turn began
  perMemberSeconds: number
  size?: "lg" | "sm"
  /** Play escalating beeps as the presenter passes time marks (moderator only). */
  beep?: boolean
}

function fmt(secs: number) {
  const m = Math.floor(Math.abs(secs) / 60)
  const s = Math.abs(secs) % 60
  return `${secs < 0 ? "+" : ""}${m}:${s.toString().padStart(2, "0")}`
}

// Elapsed-time marks (seconds) → number of beeps. Escalates each minute past 4.
const BEEP_SCHEDULE: { at: number; count: number }[] = [
  { at: 240, count: 1 }, // 4 min
  { at: 300, count: 2 }, // 5 min
  { at: 360, count: 3 }, // 6 min
  { at: 420, count: 4 }, // 7 min
  { at: 480, count: 5 }, // 8 min
]

const MUTE_KEY = "cupcake.timerMuted"

// One shared AudioContext, created lazily and resumed on a user gesture so the
// browser's autoplay policy doesn't block the beeps.
let sharedCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return null
      sharedCtx = new Ctor()
    }
    if (sharedCtx.state === "suspended") void sharedCtx.resume()
    return sharedCtx
  } catch {
    return null
  }
}

function playBeeps(count: number) {
  const ctx = getAudioCtx()
  if (!ctx) return
  const dur = 0.15
  const gap = 0.13
  for (let i = 0; i < count; i++) {
    const t = ctx.currentTime + i * (dur + gap)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }
}

export function RoundTimer({
  startedAt,
  perMemberSeconds,
  size = "lg",
  beep = false,
}: Props) {
  const [, force] = useState(0)
  const [muted, setMuted] = useState(false)

  const mutedRef = useRef(muted)
  const firedRef = useRef<Set<number>>(new Set())

  // Load persisted mute preference (per device). Done in an effect (not a lazy
  // initializer) so server and client first-render agree, avoiding hydration
  // mismatch on the button label.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMuted(localStorage.getItem(MUTE_KEY) === "1")
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // Unlock audio on the first user gesture after this timer mounts.
  useEffect(() => {
    if (!beep) return
    const unlock = () => getAudioCtx()
    window.addEventListener("pointerdown", unlock, { once: true })
    return () => window.removeEventListener("pointerdown", unlock)
  }, [beep])

  // Reset which beep marks have fired whenever a new turn starts. Marks already
  // in the past at mount are treated as fired, so we only beep on live crossings.
  useEffect(() => {
    firedRef.current = new Set()
    if (beep && startedAt) {
      const elapsed = Math.floor(
        (Date.now() - new Date(startedAt).getTime()) / 1000
      )
      for (const s of BEEP_SCHEDULE) {
        if (elapsed >= s.at) firedRef.current.add(s.at)
      }
    }
  }, [startedAt, beep])

  // Tick every second; also check beep marks on the moderator timer.
  useEffect(() => {
    if (!startedAt) return
    const tick = () => {
      force((n) => n + 1)
      if (!beep) return
      const elapsed = Math.floor(
        (Date.now() - new Date(startedAt).getTime()) / 1000
      )
      for (const s of BEEP_SCHEDULE) {
        if (elapsed >= s.at && !firedRef.current.has(s.at)) {
          firedRef.current.add(s.at) // consume even if muted (no retro beeps)
          if (!mutedRef.current) playBeeps(s.count)
        }
      }
    }
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, beep])

  function toggleMute() {
    getAudioCtx() // this click counts as the unlock gesture
    setMuted((m) => {
      const next = !m
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  if (!startedAt) {
    return null
  }

  const elapsed = Math.floor(
    (new Date().getTime() - new Date(startedAt).getTime()) / 1000
  )
  const remaining = perMemberSeconds - elapsed
  const overrun = remaining < 0
  const pct = Math.max(0, Math.min(100, (remaining / perMemberSeconds) * 100))

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "font-mono tabular-nums tracking-tight",
          size === "lg" ? "text-4xl font-semibold" : "text-lg font-medium",
          overrun ? "text-destructive" : "text-foreground"
        )}
      >
        {fmt(remaining)}
      </div>
      <div
        className={cn(
          "h-1 w-full overflow-hidden rounded-full bg-muted",
          size === "sm" && "h-0.5"
        )}
      >
        <div
          className={cn(
            "h-full transition-[width] duration-700 ease-linear",
            overrun ? "bg-destructive" : pct < 25 ? "bg-amber-500" : "bg-foreground"
          )}
          style={{ width: `${overrun ? 100 : pct}%` }}
        />
      </div>
      {beep && (
        <button
          type="button"
          onClick={toggleMute}
          className="mx-auto mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title={
            muted
              ? "Beeps muted — tap to unmute"
              : "Beeps on (4–8 min) — tap to mute"
          }
        >
          {muted ? (
            <>
              <VolumeX className="size-3.5" /> Beeps muted
            </>
          ) : (
            <>
              <Volume2 className="size-3.5" /> Beeps on
            </>
          )}
        </button>
      )}
    </div>
  )
}
