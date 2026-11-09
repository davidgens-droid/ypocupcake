// Salad Bowl — sound effects (synthesised, no audio files), buzzing, and
// keeping the screen awake during a game. Browser-only; every call is safe
// to make before the user has tapped anything (it just stays silent).

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false
let mutedLoaded = false
let resumeHooked = false
const muteListeners = new Set<() => void>()

function loadMuted() {
  if (mutedLoaded || typeof window === "undefined") return
  mutedLoaded = true
  try {
    muted = window.localStorage.getItem("sb:muted") === "1"
  } catch {
    muted = false
  }
}

export function isMuted(): boolean {
  loadMuted()
  return muted
}
export function setMuted(value: boolean) {
  muted = value
  mutedLoaded = true
  try {
    window.localStorage.setItem("sb:muted", value ? "1" : "0")
  } catch {
    // ignore
  }
  muteListeners.forEach((l) => l())
}
export function subscribeMuted(listener: () => void): () => void {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

/** Call from any tap: browsers only allow sound after a user gesture. */
export function unlockAudio() {
  if (typeof window === "undefined") return
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.5
      master.connect(ctx.destination)
      // Coming back to the page: wake the context without waiting for a tap (allowed once it has been started).
      if (!resumeHooked) {
        resumeHooked = true
        document.addEventListener("visibilitychange", () => {
          if (ctx && document.visibilityState === "visible") unlockAudio()
        })
      }
    }
    // iPhones park the context as "interrupted" (call, Siri, another app's audio, a lock) and can leave it suspended afterwards.
    if (ctx.state !== "running") void Promise.resolve(ctx.resume()).catch(() => {})
  } catch {
    ctx = null
  }
}

function ready(): boolean {
  loadMuted()
  return !!ctx && !!master && !muted && ctx.state === "running"
}

function note(
  freq: number,
  at: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; slideTo?: number; dest?: AudioNode } = {}
) {
  if (!ctx || !master) return
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = opts.type ?? "triangle"
  osc.frequency.setValueAtTime(freq, t)
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur)
  const peak = opts.gain ?? 0.5
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(opts.dest ?? master)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

/** A crunchy guitar-ish power chord: root + fifth + octave through distortion. */
function powerChord(root: number, at: number, dur: number) {
  if (!ctx || !master) return
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1
    curve[i] = Math.tanh(x * 6)
  }
  shaper.curve = curve
  const lp = ctx.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 2600
  const out = ctx.createGain()
  out.gain.value = 0.28
  shaper.connect(lp)
  lp.connect(out)
  out.connect(master)
  for (const mult of [1, 1.5, 2]) {
    note(root * mult, at, dur, { type: "sawtooth", gain: 0.5, dest: shaper })
  }
}

export const sfx = {
  /** Team got the word. */
  ding() {
    if (!ready()) return
    note(880, 0, 0.12, { type: "triangle", gain: 0.5 })
    note(1318.5, 0.08, 0.22, { type: "triangle", gain: 0.5 })
  },
  skip() {
    if (!ready()) return
    note(330, 0, 0.16, { type: "square", gain: 0.18, slideTo: 196 })
  },
  /** One of the last five seconds. */
  tick() {
    if (!ready()) return
    note(1200, 0, 0.05, { type: "square", gain: 0.2 })
  },
  /** Time's up. */
  buzzer() {
    if (!ready()) return
    note(196, 0, 0.9, { type: "sawtooth", gain: 0.45 })
    note(207, 0, 0.9, { type: "sawtooth", gain: 0.4 })
    note(98, 0, 0.9, { type: "square", gain: 0.25 })
  },
  /** You're up: three power-chord stabs. */
  yourTurn() {
    if (!ready()) return
    powerChord(164.81, 0, 0.22)
    powerChord(196.0, 0.26, 0.22)
    powerChord(220.0, 0.52, 0.7)
  },
  /** You're next. */
  onDeck() {
    if (!ready()) return
    note(523.25, 0, 0.12, { gain: 0.35 })
    note(659.25, 0.12, 0.18, { gain: 0.35 })
  },
  /** Round over. */
  fanfare() {
    if (!ready()) return
    powerChord(196.0, 0, 0.18)
    powerChord(246.94, 0.2, 0.18)
    powerChord(293.66, 0.4, 0.9)
  },
  /** Game over. */
  finale() {
    if (!ready()) return
    powerChord(164.81, 0, 0.2)
    powerChord(164.81, 0.22, 0.2)
    powerChord(196.0, 0.44, 0.2)
    powerChord(246.94, 0.66, 0.2)
    powerChord(329.63, 0.9, 1.6)
    ;[1318.5, 1568, 2093].forEach((f, i) => note(f, 1.0 + i * 0.12, 0.5, { gain: 0.25 }))
  },
  /** Somebody joined the lobby. */
  join() {
    if (!ready()) return
    note(660, 0, 0.1, { gain: 0.25 })
  },
  /** Light tap feedback. */
  tap() {
    if (!ready()) return
    note(520, 0, 0.04, { type: "square", gain: 0.1 })
  },
}

/** Vibrate (Android; iPhones ignore it). Respects the mute switch. */
export function buzz(pattern: number | number[]) {
  loadMuted()
  if (muted || typeof navigator === "undefined" || !("vibrate" in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // ignore
  }
}

// ─── keep the screen on while a game is running ──────────────────────────────

type Sentinel = { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void }
let sentinel: Sentinel | null = null
let wantAwake = false
let visibilityHooked = false

async function acquire() {
  if (!wantAwake || sentinel || typeof navigator === "undefined") return
  const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock
  if (!wl || document.visibilityState !== "visible") return
  try {
    const s = await wl.request("screen")
    sentinel = s
    s.addEventListener("release", () => {
      sentinel = null
    })
    if (!wantAwake) void s.release()
  } catch {
    sentinel = null
  }
}

export function keepAwake(on: boolean) {
  if (typeof document === "undefined") return
  wantAwake = on
  if (!visibilityHooked) {
    visibilityHooked = true
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void acquire()
    })
  }
  if (on) void acquire()
  else if (sentinel) {
    const s = sentinel
    sentinel = null
    void s.release().catch(() => {})
  }
}
