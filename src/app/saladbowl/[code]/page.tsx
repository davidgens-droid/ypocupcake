import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { GameRoom } from "@/components/saladbowl/game-room"

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params
  return { title: `Game ${code.toUpperCase().slice(0, 4)}` }
}

export default async function SaladBowlGame({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[A-Za-z]{4}$/.test(code)) notFound()
  const upper = code.toUpperCase()
  return <GameRoom key={upper} code={upper} />
}
