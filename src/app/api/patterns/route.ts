import { NextResponse } from "next/server"

import { generatePatternCards, patternsInputSchema } from "@/lib/ai/patterns"
import { getCurrentMember } from "@/lib/auth/current-member"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Pattern cards for the dashboard. The member's device decrypts their
 * recent finalized updates and POSTs them here; the cards come back and are
 * encrypted on the device before being stored. A route handler (not a
 * Server Action) so the dashboard never blocks on the AI. The request body
 * is handed to the generator and never logged.
 */
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 })
  }
  const parsed = patternsInputSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 })

  const result = await generatePatternCards(me, parsed.data.updates, parsed.data.dates ?? [])
  return NextResponse.json(result)
}
