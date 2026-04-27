import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft } from "lucide-react"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

const ROUND_LABEL: Record<string, string> = {
  updates: "Updates round",
  experience_sharing: "Experience sharing",
  commitments: "Commitments",
  lightning: "Lightning round",
  brainstorm: "Brainstorm",
  needs_and_leads: "Needs & Leads",
}

export default async function MeetingPage({ params }: { params: Params }) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  const [{ data: meeting }, { data: rounds }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, status")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("meeting_rounds")
      .select("id, round_type, order_member_ids, current_index, started_at, ended_at")
      .eq("meeting_id", id)
      .order("started_at", { ascending: false }),
  ])

  if (!meeting) notFound()

  const activeRound = (rounds ?? []).find((r) => !r.ended_at) ?? null
  const myIndex = activeRound
    ? activeRound.order_member_ids.indexOf(me.id)
    : -1
  const isUpNow =
    activeRound && myIndex >= 0 && myIndex === activeRound.current_index

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/dashboard" />}>
        <ChevronLeft className="size-4" /> Dashboard
      </Button>

      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {format(parseISO(meeting.scheduled_at), "EEE MMM d, yyyy · h:mm a")}
        </h1>
        <p className="text-sm text-muted-foreground">
          📍 {meeting.location ?? "TBD"} · status:{" "}
          <span className="uppercase tracking-wide">{meeting.status}</span>
        </p>
      </div>

      {meeting.status === "upcoming" && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Meeting hasn&apos;t started. The moderator will kick it off.
          </CardContent>
        </Card>
      )}

      {meeting.status === "in_progress" && !activeRound && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Meeting in progress. Waiting for the moderator to start the next
            round.
          </CardContent>
        </Card>
      )}

      {meeting.status === "in_progress" && activeRound && (
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {ROUND_LABEL[activeRound.round_type] ?? activeRound.round_type}
            </p>
            {isUpNow ? (
              <p className="font-heading text-2xl font-semibold">
                You&apos;re up.
              </p>
            ) : (
              <p className="font-heading text-2xl font-semibold">Listening</p>
            )}
            <p className="text-sm text-muted-foreground">
              {Math.min(activeRound.current_index, activeRound.order_member_ids.length)} of{" "}
              {activeRound.order_member_ids.length} revealed.
            </p>
            <p className="text-xs text-muted-foreground">
              Order is randomized and hidden — your turn may come at any time.
            </p>
            <p className="text-xs text-muted-foreground italic">
              (Refresh manually until live updates ship.)
            </p>
          </CardContent>
        </Card>
      )}

      {meeting.status === "closed" && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Meeting closed{" "}
            {meeting.scheduled_at &&
              format(parseISO(meeting.scheduled_at), "MMM d")}.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
