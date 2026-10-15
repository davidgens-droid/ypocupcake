import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { notFound, redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  ParkingLotReview,
  type ReviewItem,
} from "@/components/app/parking-lot/parking-lot-review"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { getMyRoles, isParkingLotPrivileged } from "@/lib/auth/roles"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

// The merge step calls Claude; give the Server Action room beyond the default
// function timeout (Vercel Pro allows up to 300s).
export const maxDuration = 120

export default async function ParkingLotReviewPage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  // Privileged only — moderator / assistant_moderator / czar / admin.
  const myRoles = await getMyRoles(me)
  const isPrivileged = isParkingLotPrivileged(me, myRoles)
  if (!isPrivileged) redirect(`/meeting/${id}`)

  const [
    { data: meeting },
    { data: capturedRaw },
    { data: parkedRaw },
    { data: members },
    { data: formats },
  ] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, status")
      .eq("id", id)
      .eq("forum_id", me.forum_id)
      .maybeSingle(),
    supabase
      .from("parking_lot_items")
      .select(
        "id, topic, context, urgency, tool_category, exploration_format, submitter_member_id"
      )
      .eq("status", "captured")
      .eq("captured_meeting_id", id)
      .eq("forum_id", me.forum_id)
      .order("created_at", { ascending: true }),
    supabase
      .from("parking_lot_items")
      .select(
        "id, topic, context, urgency, tool_category, exploration_format, submitter_member_id"
      )
      .eq("status", "parked")
      .order("created_at", { ascending: false }),
    supabase.from("members").select("id, name"),
    supabase
      .from("exploration_formats")
      .select("code, display_name, default_minutes, category"),
  ])

  if (!meeting) notFound()

  const memberName = Object.fromEntries(
    (members ?? []).map((m) => [m.id, m.name])
  )
  const formatLabel = Object.fromEntries(
    (formats ?? []).map((f) => [
      f.code,
      `${f.display_name} · ${f.default_minutes}m`,
    ])
  )

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <Button
        size="sm"
        variant="ghost"
        render={<Link href={`/meeting/${id}/run`} />}
      >
        <ChevronLeft className="size-4" /> Meeting room
      </Button>

      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          Review parking-lot topics
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy")} · Decide what
          to do with everything captured tonight.
        </p>
      </header>

      <ParkingLotReview
        captured={(capturedRaw ?? []) as ReviewItem[]}
        parked={(parkedRaw ?? []) as ReviewItem[]}
        memberName={memberName}
        formatLabel={formatLabel}
        formats={(formats ?? []).map((f) => ({
          code: f.code,
          display_name: f.display_name,
          category: f.category,
        }))}
      />
    </div>
  )
}
