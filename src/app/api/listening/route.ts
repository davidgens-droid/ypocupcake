import { NextResponse } from "next/server"

import { extractParkingLotTopics } from "@/lib/ai/listening"
import { getCurrentMember } from "@/lib/auth/current-member"

export const runtime = "nodejs"
// The Claude call is bounded at 55s × 2 attempts inside a 90s deadline.
export const maxDuration = 120

/**
 * Listening mode: the moderator's browser POSTs one presenter's transcript
 * here the moment their turn ends; Claude lists the potential parking-lot
 * topics and they're saved as 'captured' suggestions. A route handler (not a
 * Server Action) so the extraction never queues behind — or blocks — the
 * runner's next reveal, and so a flush fired while navigating away runs
 * under THIS route's maxDuration, not the destination page's.
 *
 * The transcript is read from the request and handed straight to the
 * extractor; it is never logged here.
 */
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 })

  let body: { meetingId?: unknown; presenterMemberId?: unknown; transcript?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 })
  }
  if (
    typeof body.meetingId !== "string" ||
    typeof body.presenterMemberId !== "string" ||
    typeof body.transcript !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 })
  }

  const result = await extractParkingLotTopics(me, {
    meetingId: body.meetingId,
    presenterMemberId: body.presenterMemberId,
    transcript: body.transcript,
  })
  return NextResponse.json(result)
}
