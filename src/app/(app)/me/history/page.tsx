import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type UpdateRow = {
  meeting_id: string
  content: unknown | null
  content_enc: string | null
  qol_physical: number | null
  qol_mental: number | null
  qol_financial: number | null
  qol_friends: number | null
  ready: boolean
  completed_at: string | null
  updated_at: string
  meetings: {
    scheduled_at: string
    location: string | null
  } | null
}

/** The list needs only metadata and the four QoL scores; nothing is decrypted here. */
export default async function PastUpdatesPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from("updates")
    .select(
      "meeting_id, content, content_enc, qol_physical, qol_mental, qol_financial, qol_friends, ready, completed_at, updated_at, meetings(scheduled_at, location)"
    )
    .eq("member_id", me.id)
    .order("updated_at", { ascending: false })
    .returns<UpdateRow[]>()

  const all = rows ?? []

  // Only show updates whose meeting has already happened (or is happening now).
  // The /me/update page handles the current upcoming meeting. Most recent
  // meeting first: the row's updated_at is no guide (a bulk re-encryption
  // touches every row at once).
  const now = new Date().getTime()
  const past = all
    .filter((r) => {
      if (!r.meetings) return false
      return new Date(r.meetings.scheduled_at).getTime() < now
    })
    .sort((a, b) => new Date(b.meetings!.scheduled_at).getTime() - new Date(a.meetings!.scheduled_at).getTime())

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Past updates</h1>
        <p className="text-sm text-muted-foreground">
          Every update you&apos;ve prepped. Encrypted so only you can read them —
          except your Quality of Life numbers, which forum leadership can see in
          QOL History.
        </p>
      </div>

      {past.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No past updates yet. They&apos;ll appear here after your meetings.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {past.map((row) => (
            <PastUpdateCard key={row.meeting_id} row={row} timezone={me.forum.timezone} />
          ))}
        </ul>
      )}
    </div>
  )
}

function qolOf(row: UpdateRow): { p: number; m: number; f: number; c: number } | null {
  if (row.qol_physical != null && row.qol_mental != null && row.qol_financial != null && row.qol_friends != null) {
    return { p: row.qol_physical, m: row.qol_mental, f: row.qol_financial, c: row.qol_friends }
  }
  // A row not yet migrated still carries its scores inside the readable content.
  const legacy = (row.content as { qol?: Record<string, number> } | null)?.qol
  if (!legacy) return null
  return { p: legacy.physical_health, m: legacy.mental_health, f: legacy.financial_health, c: legacy.friends_community }
}

function PastUpdateCard({ row, timezone }: { row: UpdateRow; timezone: string }) {
  const meeting = row.meetings!
  const qol = qolOf(row)
  const status = row.completed_at ? (row.ready ? "Ready" : "Finalized") : "Draft"

  return (
    <li>
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy", timezone)}</p>
            <p className="text-xs text-muted-foreground">
              {meeting.location ?? "TBD"}
              {row.completed_at && (
                <>
                  {" · "}
                  {status === "Draft" ? "Last edited " : status === "Ready" ? "Ready · finalized " : "Finalized "}
                  {format(parseISO(row.completed_at), "MMM d, yyyy")}
                </>
              )}
              {!row.completed_at && <> · Draft · last edited {format(parseISO(row.updated_at), "MMM d, yyyy")}</>}
            </p>
            {qol && (
              <p className="text-xs text-muted-foreground">
                QoL · P {qol.p} · M {qol.m} · F {qol.f} · C {qol.c}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" render={<Link href={`/me/history/${row.meeting_id}`} />}>
              View <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  )
}
