"use client"

// Salad Bowl — getting people into the game: QR code, the four-letter code,
// and a link to text around.
import { useMemo, useState } from "react"
import qrcode from "qrcode-generator"
import { Copy, Share2 } from "lucide-react"

import { Button, Display, Kicker } from "./ui"

/** A QR code as crisp SVG (no network, no images). */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M")
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ""
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`
      }
    }
    return { path: d, count: n }
  }, [value])
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-2 -2 ${count + 4} ${count + 4}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code to join the game"
      style={{ background: "#fff", borderRadius: 10, border: "3px solid var(--sb-ink)", flex: "none" }}
    >
      <path d={path} fill="#0c0c0e" />
    </svg>
  )
}

/** The address players type or scan. Uses the page's own origin. */
export function joinUrl(code: string): string {
  const origin = typeof window === "undefined" ? "https://www.ypocupcake.com" : window.location.origin
  return `${origin}/saladbowl/${code}`
}

/** QR + code + "copy link" / "share". Sits on a paper card or sheet (dark text). */
export function SharePanel({ code, qrSize = 190 }: { code: string; qrSize?: number }) {
  const [copied, setCopied] = useState(false)
  const url = joinUrl(code)
  const pretty = url.replace(/^https?:\/\/(www\.)?/, "")
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "Salad Bowl", text: `Join my Salad Bowl game. Code ${code}`, url })
    } catch {
      // closed the share sheet: nothing to do
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
      <QrCode value={url} size={qrSize} />
      <div>
        <Kicker tone="ink">Game code</Kicker>
        <Display as="div" size="3.4rem" style={{ letterSpacing: "0.18em", paddingLeft: "0.18em" }}>
          {code}
        </Display>
        <p className="sb-cond" style={{ margin: "2px 0 0", fontSize: "0.92rem", wordBreak: "break-all", textTransform: "none", letterSpacing: "0.02em" }}>
          {pretty}
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Button size="sm" variant="paper" onClick={copy}>
          <Copy size={18} /> {copied ? "Copied!" : "Copy link"}
        </Button>
        {canShare && (
          <Button size="sm" variant="cyan" onClick={share}>
            <Share2 size={18} /> Send it
          </Button>
        )}
      </div>
    </div>
  )
}
