import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { TvScreen } from "@/components/saladbowl/tv"

export const metadata: Metadata = { title: "Big screen" }

export default async function SaladBowlTv({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[A-Za-z]{4}$/.test(code)) notFound()
  const upper = code.toUpperCase()
  return <TvScreen key={upper} code={upper} />
}
