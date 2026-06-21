import Link from "next/link"
import { formatMeeting } from "@/lib/dates"
import { ChevronLeft } from "lucide-react"
import { notFound, redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RunnerControls } from "@/components/app/meeting/runner-controls"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { ExplorationFormatCode } from "@/lib/types/domain"

type Params = Promise<{ id: string }>

export default async function RunMeetingPage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  // Verify caller is moderator/asst or admin
  const { data: roles } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const isMod = (roles ?? []).some((r) =>
    ["moderator", "assistant_moderator"].includes(r.role_type)
  )
  if (!isMod && !me.is_admin) {
    redirect(`/meeting/${id}`)
  }

  const [{ data: meeting }, { data: members }, { data: rounds }, { data: parking }, { data: formats }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("id, scheduled_at, location, status")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("members").select("id, name"),
      supabase
        .from("meeting_rounds")
        .select(
          "id, round_type, order_member_ids, current_index, started_at, ended_at, current_started_at, per_member_seconds, exploration_format, phase_index, phase_started_at, parking_lot_item_id"
        )
        .eq("meeting_id", id)
        .order("started_at", { ascending: false }),
      supabase
        .from("parking_lot_items")
        .select("id, topic, exploration_format, status, scheduled_meeting_id")
        .in("status", ["parked", "scheduled"])
        .order("created_at", { ascending: false }),
      supabase
        .from("exploration_formats")
        .select("code, display_name, default_minutes"),
    ])

  if (!meeting) notFound()

  const memberName = Object.fromEntries(
    (members ?? []).map((m) => [m.id, m.name])
  )

  const activeRound = (rounds ?? []).find((r) => !r.ended_at) ?? null

  const formatLabel = new Map(
    (formats ?? []).map((f) => [
      f.code,
      `${f.display_name} · ${f.default_minutes}m`,
    ])
  )
  const parkingLotChoices = (parking ?? []).map((p) => ({
    id: p.id,
    topic: p.topic,
    exploration_format: p.exploration_format as ExplorationFormatCode,
    format_label: formatLabel.get(p.exploration_format) ?? p.exploration_format,
  }))

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button
        size="sm"
        variant="ghost"
        render={<Link href="/dashboard" />}
      >
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

      <Card>
        <CardContent className="py-5">
          <RunnerControls
            meetingId={meeting.id}
            status={meeting.status}
            activeRound={activeRound}
            memberName={memberName}
            parkingLotChoices={parkingLotChoices}
          />
        </CardContent>
      </Card>

      {activeRound && (
        <p className="text-xs text-muted-foreground">
          Round: {activeRound.round_type}
          {activeRound.exploration_format && (
            <> · {formatLabel.get(activeRound.exploration_format) ?? activeRound.exploration_format}</>
          )}
          {" "}· you choose who&apos;s next; members only ever see their own turn.
        </p>
      )}
    </div>
  )
}
