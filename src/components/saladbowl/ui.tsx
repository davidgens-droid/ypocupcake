"use client"

// Salad Bowl — shared building blocks. Styling lives in
// src/app/saladbowl/saladbowl.css (the sb-* classes); these components just
// make the common pieces easy to use consistently.
import { useEffect, useSyncExternalStore, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react"
import { Volume2, VolumeX, X } from "lucide-react"

import { isMuted, setMuted, sfx, subscribeMuted, unlockAudio } from "@/lib/saladbowl/sound"

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ")
}

// ─── page ────────────────────────────────────────────────────────────────────

/** A full screen. tone "team" floods it with that team's colour (pass `team`). */
export function Page({
  tone = "black",
  team,
  flash,
  className,
  children,
}: {
  tone?: "black" | "team" | "sunset"
  team?: number | null
  /** Change this value to strobe the screen once (e.g. when your turn starts). */
  flash?: string | number | null
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cx("sb-page", tone === "team" && "sb-page--team", tone === "sunset" && "sb-page--sunset", className)}
      data-team={team ?? undefined}
    >
      {flash != null && <span key={flash} className="sb-flash" aria-hidden />}
      <div className="sb-wrap">{children}</div>
    </div>
  )
}

// ─── type ────────────────────────────────────────────────────────────────────

export function Display({
  as: Tag = "h1",
  variant,
  size,
  className,
  style,
  children,
}: {
  as?: "h1" | "h2" | "h3" | "p" | "div" | "span"
  /** pop: black with pink shadow (on paper/colour). glow: white with pink shadow (on black). */
  variant?: "pop" | "pop-soft" | "glow"
  /** CSS font-size, e.g. "3.2rem" or "clamp(2.6rem, 14vw, 5rem)". */
  size?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <Tag className={cx("sb-display", variant && `sb-display--${variant}`, className)} style={{ fontSize: size, ...style }}>
      {children}
    </Tag>
  )
}

export function Kicker({ tone, className, children }: { tone?: "ink" | "muted"; className?: string; children: ReactNode }) {
  return <p className={cx("sb-kicker", tone && `sb-kicker--${tone}`, className)}>{children}</p>
}

export function Label({ tone, className, children }: { tone?: "paper" | "team" | "yellow"; className?: string; children: ReactNode }) {
  return <span className={cx("sb-label", tone && `sb-label--${tone}`, className)}>{children}</span>
}

/** Marker-pen note. `arrow` draws the little "←" the tour book uses. */
export function Marker({
  tone,
  arrow,
  className,
  children,
}: {
  tone?: "blue" | "yellow" | "white"
  arrow?: "left" | "right"
  className?: string
  children: ReactNode
}) {
  return (
    <span className={cx("sb-marker", tone && `sb-marker--${tone}`, className)}>
      {arrow === "left" && "← "}
      {children}
      {arrow === "right" && " →"}
    </span>
  )
}

export function Stamp({ tone, className, children }: { tone?: "ink" | "green" | "yellow"; className?: string; children: ReactNode }) {
  return <span className={cx("sb-stamp", tone && `sb-stamp--${tone}`, className)}>{children}</span>
}

export function Stars({ count = 7 }: { count?: number }) {
  return (
    <div className="sb-stars" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i}>★</span>
      ))}
    </div>
  )
}

export function TeamDot({ team, className }: { team: number | null | undefined; className?: string }) {
  return <span className={cx("sb-dot", className)} data-team={team ?? 0} aria-hidden />
}

// ─── containers ──────────────────────────────────────────────────────────────

/** Cream paper card. tape: a strip of gaffer tape; bar: coloured top edge. */
export function Card({
  tape,
  bar,
  tilt,
  team,
  className,
  style,
  children,
}: {
  tape?: boolean | "corners"
  bar?: "team" | "yellow" | "cyan" | "purple" | "pink"
  tilt?: "l" | "r"
  team?: number | null
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <section
      className={cx(
        "sb-card",
        bar === "team" && "sb-card--bar",
        bar && bar !== "team" && `sb-card--bar-${bar}`,
        tilt && `sb-card--tilt-${tilt}`,
        className
      )}
      data-team={team ?? undefined}
      style={style}
    >
      {tape === true && <span className="sb-tape" aria-hidden />}
      {tape === "corners" && (
        <>
          <span className="sb-tape sb-tape--l" aria-hidden />
          <span className="sb-tape sb-tape--r" aria-hidden />
        </>
      )}
      {children}
    </section>
  )
}

/** Black rounded panel with a tab label ("LINER NOTES"). */
export function Liner({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section className={cx("sb-liner", className)}>
      <Label tone="paper">{label}</Label>
      {children}
    </section>
  )
}

/** The all-access laminate. */
export function Pass({
  head = "All Access",
  foot,
  className,
  children,
}: {
  head?: ReactNode
  foot?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx("sb-pass", className)}>
      <div className="sb-pass-head">
        <span className="sb-star">★</span>
        {head}
        <span className="sb-star">★</span>
      </div>
      <div className="sb-pass-body">{children}</div>
      {foot && <div className="sb-pass-foot">{foot}</div>}
    </div>
  )
}

export function Marquee({ items }: { items: string[] }) {
  const run = [...items, ...items, ...items]
  return (
    <div className="sb-marquee" aria-hidden>
      <div>
        {run.map((t, i) => (
          <span key={i} style={{ color: i % 2 ? undefined : "#fff" }}>
            {t} <b style={{ color: "var(--sb-pink)" }}>★</b>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── controls ────────────────────────────────────────────────────────────────

export function Button({
  variant = "yellow",
  size,
  inline,
  className,
  onClick,
  children,
  ...rest
}: {
  variant?: "yellow" | "pink" | "cyan" | "green" | "paper" | "team" | "ink" | "ghost"
  size?: "sm" | "xl"
  inline?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cx("sb-btn", variant !== "yellow" && `sb-btn--${variant}`, size && `sb-btn--${size}`, inline && "sb-btn--inline", className)}
      onClick={(e) => {
        unlockAudio()
        sfx.tap()
        onClick?.(e)
      }}
    >
      {children}
    </button>
  )
}

export function MuteButton({ className }: { className?: string }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)
  return (
    <button
      type="button"
      className={cx("sb-iconbtn", className)}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      aria-pressed={muted}
      onClick={() => {
        unlockAudio()
        setMuted(!muted)
      }}
    >
      {muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
    </button>
  )
}

/** Bottom sheet. Closes on backdrop tap, the X, or Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="sb-backdrop" onClick={onClose}>
      <div className="sb-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sb-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="sb-iconbtn" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", gap: 14, padding: 24 }} role="status">
      <div className="sb-spinner" />
      {label && <Kicker tone="muted">{label}</Kicker>}
    </div>
  )
}

// ─── the tempo badge (the countdown) ─────────────────────────────────────────

const SCALLOP = (() => {
  // A circle with a wavy edge, like the "TEMPO 100 BPM" seal in the tour book.
  const points: string[] = []
  const bumps = 22
  for (let i = 0; i <= 360; i += 2) {
    const a = (i * Math.PI) / 180
    const r = 47 + 2.6 * Math.cos(bumps * a)
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${points.join("L")}Z`
})()

/** Scalloped seal with a big number: the clock, a score, a count. */
export function TempoBadge({
  value,
  top,
  bottom,
  size = 132,
  ring = "var(--sb-team)",
  urgent,
  className,
}: {
  value: ReactNode
  /** Small text above the number, e.g. "TEMPO". */
  top?: string
  /** Small text below, e.g. "SECONDS". */
  bottom?: string
  size?: number
  /** Colour of the inner ring. */
  ring?: string
  /** Last seconds: turns red and pulses. */
  urgent?: boolean
  className?: string
}) {
  const text = String(value)
  const fontSize = text.length >= 4 ? 25 : text.length === 3 ? 31 : 40
  return (
    <div className={cx(urgent && "sb-pulse", className)} style={{ width: size, height: size, flex: "none" }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${top ?? ""} ${text} ${bottom ?? ""}`.trim()}>
        {/* the faint light edge keeps the seal visible on the black stage */}
        <path d={SCALLOP} fill={urgent ? "var(--sb-red)" : "var(--sb-ink)"} stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="40.5" fill="none" stroke={urgent ? "#fff" : ring} strokeWidth="1.6" />
        {top && (
          <text x="50" y="27" textAnchor="middle" fill={urgent ? "#fff" : ring} style={{ font: "700 7.5px var(--sb-cond)", letterSpacing: "0.22em" }}>
            {top.toUpperCase()}
          </text>
        )}
        <text x="50" y={top || bottom ? 62 : 64} textAnchor="middle" fill="#fff" style={{ font: `400 ${fontSize}px var(--sb-display)`, letterSpacing: "0.01em" }}>
          {text}
        </text>
        {bottom && (
          <text x="50" y="77" textAnchor="middle" fill={urgent ? "#fff" : ring} style={{ font: "700 7.5px var(--sb-cond)", letterSpacing: "0.22em" }}>
            {bottom.toUpperCase()}
          </text>
        )}
      </svg>
    </div>
  )
}

// ─── toasts ──────────────────────────────────────────────────────────────────

interface ToastItem {
  id: number
  text: string
  bad: boolean
}
let toasts: ToastItem[] = []
let toastId = 0
const toastListeners = new Set<() => void>()
const EMPTY: ToastItem[] = []

/** Pop a short message at the top of the screen. `bad` = something went wrong. */
export function toast(text: string, bad = false) {
  const id = ++toastId
  toasts = [...toasts.slice(-2), { id, text, bad }]
  toastListeners.forEach((l) => l())
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    toastListeners.forEach((l) => l())
  }, 3200)
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l)
      return () => toastListeners.delete(l)
    },
    () => toasts,
    () => EMPTY
  )
  return (
    <div className="sb-toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx("sb-toast", t.bad && "sb-toast--bad")}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ─── confetti ────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#ff2e7e", "#ffc81f", "#1fb4f0", "#8b6cf6", "#2fd27a", "#ff7a1a", "#ffffff"]

/** A burst of falling confetti. Mount it to fire; change `key` to fire again. */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  return (
    <div className="sb-confetti" aria-hidden>
      {Array.from({ length: pieces }, (_, i) => {
        // Deterministic scatter (no randomness during render).
        const left = (i * 37 + 11) % 100
        const delay = ((i * 53) % 24) / 10
        const dur = 2.6 + ((i * 29) % 22) / 10
        const dx = ((i * 71) % 160) - 80
        return (
          <i
            key={i}
            style={
              {
                left: `${left}%`,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${delay}s`,
                animationDuration: `${dur}s`,
                borderRadius: i % 3 === 0 ? "50%" : 2,
                width: i % 4 === 0 ? 8 : 10,
                "--dx": `${dx}px`,
                "--rot": `${360 + ((i * 97) % 720)}deg`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}
