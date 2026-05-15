import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"

type UpdateRow = {
  meeting_id: string
  content: unknown
  ready: boolean
  completed_at: string | null
  updated_at: string
  meetings: {
    scheduled_at: string
    location: string | null
  } | null
}

export default async function PastUpdatesPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  // Pull every update this member has authored, with its meeting. We surface
  // both finalized and in-progress drafts for past meetings so a member can
  // always find what they prepped.
  const { data: rows } = await supabase
    .from("updates")
    .select(
      "meeting_id, content, ready, completed_at, updated_at, meetings(scheduled_at, location)"
    )
    .eq("member_id", me.id)
    .order("updated_at", { ascending: false })
    .returns<UpdateRow[]>()

  const all = rows ?? []

  // Only show updates whose meeting has already happened (or is happening now).
  // The /me/update page handles the current upcoming meeting.
  const now = new Date().getTime()
  const past = all.filter((r) => {
    if (!r.meetings) return false
    return new Date(r.meetings.scheduled_at).getTime() < now
  })

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/dashboard" />}>
        <ChevronLeft className="size-4" /> Dashboard
      </Button>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Past updates</h1>
        <p className="text-sm text-muted-foreground">
          Every update you&apos;ve prepped. Private to you.
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
            <PastUpdateCard key={row.meeting_id} row={row} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PastUpdateCard({ row }: { row: UpdateRow }) {
  const meeting = row.meetings!
  let content: UpdateContent = emptyUpdateContent
  if (row.content) {
    const parsed = updateContentSchema.safeParse(row.content)
    if (parsed.success) content = parsed.data
  }

  const status = row.completed_at
    ? row.ready
      ? "Ready"
      : "Finalized"
    : "Draft"

  return (
    <li>
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">
              {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy")}
            </p>
            <p className="text-xs text-muted-foreground">
              {meeting.location ?? "TBD"}
              {row.completed_at && (
                <>
                  {" · "}
                  {status === "Draft"
                    ? "Last edited "
                    : status === "Ready"
                      ? "Ready · finalized "
                      : "Finalized "}
                  {format(parseISO(row.completed_at), "MMM d, yyyy")}
                </>
              )}
              {!row.completed_at && (
                <> · Draft · last edited {format(parseISO(row.updated_at), "MMM d, yyyy")}</>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              QoL · P {content.qol.physical_health} · M{" "}
              {content.qol.mental_health} · F {content.qol.financial_health} ·
              C {content.qol.friends_community}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              render={<Link href={`/me/history/${row.meeting_id}`} />}
            >
              View <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  )
}
