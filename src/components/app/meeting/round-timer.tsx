"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

type Props = {
  startedAt: string | null // ISO timestamp when the current member's turn began
  perMemberSeconds: number
  size?: "lg" | "sm"
}

function fmt(secs: number) {
  const m = Math.floor(Math.abs(secs) / 60)
  const s = Math.abs(secs) % 60
  return `${secs < 0 ? "+" : ""}${m}:${s.toString().padStart(2, "0")}`
}

export function RoundTimer({ startedAt, perMemberSeconds, size = "lg" }: Props) {
  const [, force] = useState(0)

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) {
    return null
  }

  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
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
    </div>
  )
}
