import Link from "next/link"
import { formatMeeting } from "@/lib/dates"
import { ChevronLeft } from "lucide-react"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { MemberMeetingView } from "@/components/app/meeting/member-meeting-view"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

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
      .select(
        "id, round_type, order_member_ids, current_index, started_at, ended_at, current_started_at, per_member_seconds, exploration_format, phase_index, phase_started_at, parking_lot_item_id"
      )
      .eq("meeting_id", id)
      .order("started_at", { ascending: false }),
  ])

  if (!meeting) notFound()

  const activeRound = (rounds ?? []).find((r) => !r.ended_at) ?? null

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/dashboard" />}>
        <ChevronLeft className="size-4" /> Dashboard
      </Button>

      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy · h:mm a")}
        </h1>
        <p className="text-sm text-muted-foreground">
          📍 {meeting.location ?? "TBD"} · status:{" "}
          <span className="uppercase tracking-wide">{meeting.status}</span>
        </p>
      </div>

      <MemberMeetingView
        meetingId={meeting.id}
        status={meeting.status}
        activeRound={activeRound}
        myMemberId={me.id}
      />
    </div>
  )
}
