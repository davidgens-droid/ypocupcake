// Salad Bowl — a standalone party game that happens to live on this domain.
// It shares nothing with Cupcake: its own fonts, styles, title and icon.
import type { Metadata, Viewport } from "next"
import { Anton, Barlow, Barlow_Condensed, Permanent_Marker } from "next/font/google"

import "./saladbowl.css"

const display = Anton({ weight: "400", subsets: ["latin"], variable: "--font-sb-display", display: "swap" })
const body = Barlow({ weight: ["400", "500", "600"], style: ["normal", "italic"], subsets: ["latin"], variable: "--font-sb-body", display: "swap" })
const cond = Barlow_Condensed({ weight: ["500", "600", "700"], subsets: ["latin"], variable: "--font-sb-cond", display: "swap" })
const hand = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--font-sb-hand", display: "swap" })

export const metadata: Metadata = {
  title: { default: "Salad Bowl", template: "%s · Salad Bowl" },
  description: "The party game, live from your living room. One bowl of words, three rounds, everyone on their own phone.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Salad Bowl", statusBarStyle: "black-translucent" },
}

export const viewport: Viewport = {
  themeColor: "#0c0c0e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function SaladBowlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sb-root ${display.variable} ${body.variable} ${cond.variable} ${hand.variable}`}>{children}</div>
  )
}
