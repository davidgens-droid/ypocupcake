import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft, Info } from "lucide-react"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  CategoryBadge,
  StatusBadge,
  UrgencyDot,
} from "@/components/app/parking-lot/status-pill"
import {
  reparkItem,
  withdrawParkingLotItem,
} from "@/lib/parking-lot/actions"
import { ScheduleControl } from "@/components/app/parking-lot/schedule-control"
import { MarkDiscussedButton } from "@/components/app/parking-lot/mark-discussed-button"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

export default async function ParkingLotItemPage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: item },
    { data: formats },
    { data: members },
    { data: upcomingMeetings },
  ] = await Promise.all([
    supabase
      .from("parking_lot_items")
      .select(
        "id, topic, context, urgency, tool_category, exploration_format, status, submitter_member_id, added_by_member_id, created_at, presented_at, takeaways, scheduled_meeting_id"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("exploration_formats")
      .select(
        "code, display_name, default_minutes, category, short_description, moderator_instructions"
      ),
    supabase.from("members").select("id, name"),
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, status")
      .or(`status.eq.upcoming,status.eq.in_progress`)
      .gte(
        "scheduled_at",
        new Date(new Date().getTime() - 1000 * 60 * 60 * 24).toISOString()
      )
      .order("scheduled_at", { ascending: true }),
  ])

  if (!item) notFound()

  const submitter =
    (members ?? []).find((m) => m.id === item.submitter_member_id)?.name ?? "—"
  const addedByOther = item.added_by_member_id !== item.submitter_member_id
  const addedByName = addedByOther
    ? (members ?? []).find((m) => m.id === item.added_by_member_id)?.name ?? "another member"
    : null

  const fmt = (formats ?? []).find((f) => f.code === item.exploration_format)
  const isSubmitter = item.submitter_member_id === me.id
  const isEditable = isSubmitter && item.status === "parked"
  const isClosed = item.status === "presented" || item.status === "archived"

  // Privileged roles can edit any item at any status.
  const { data: rolesRaw } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const myRoles = (rolesRaw ?? []).map((r) => r.role_type)
  const isPrivileged =
    me.is_admin ||
    myRoles.includes("moderator") ||
    myRoles.includes("assistant_moderator") ||
    myRoles.includes("czar")
  const canEdit = isPrivileged || isEditable

  const withdraw = async () => {
    "use server"
    await withdrawParkingLotItem(id)
  }
  const repark = async () => {
    "use server"
    await reparkItem(id)
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/forum/parking-lot" />}
        >
          <ChevronLeft className="size-4" /> Parking Lot
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <UrgencyDot value={item.urgency} />
          <CategoryBadge value={item.tool_category} />
          <StatusBadge value={item.status} />
        </div>
        <h1 className="font-heading text-2xl font-semibold">{item.topic}</h1>
        <p className="text-sm text-muted-foreground">
          Submitted by {submitter}
          {addedByOther && ` (added by ${addedByName})`} ·{" "}
          {format(parseISO(item.created_at), "MMM d, yyyy")}
        </p>
      </div>

      {item.context && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Context</h2>
          <Card>
            <CardContent className="py-3 text-sm whitespace-pre-line">
              {item.context}
            </CardContent>
          </Card>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Format</h2>
        <Card>
          <CardContent className="space-y-2 py-3 text-sm">
            <p className="font-medium">
              {fmt?.display_name ?? item.exploration_format} ·{" "}
              {fmt?.default_minutes ?? "?"} min
            </p>
            <p className="text-muted-foreground">{fmt?.short_description}</p>
            {fmt && (
              <Dialog>
                <DialogTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <Info className="size-3" /> Full moderator guidance
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{fmt.display_name}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      {fmt.default_minutes} min · {fmt.category}
                    </p>
                    <p>{fmt.short_description}</p>
                    <p className="whitespace-pre-line text-muted-foreground">
                      {fmt.moderator_instructions}
                    </p>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardContent>
        </Card>
      </section>

      {item.takeaways && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Takeaways</h2>
          <Card>
            <CardContent className="py-3 text-sm whitespace-pre-line">
              {item.takeaways}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Show currently-scheduled meeting to everyone */}
      {item.scheduled_meeting_id && (() => {
        const m = (upcomingMeetings ?? []).find(
          (x) => x.id === item.scheduled_meeting_id
        )
        if (!m) return null
        return (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Scheduled for</h2>
            <Card>
              <CardContent className="py-3 text-sm">
                {formatMeeting(m.scheduled_at, "EEE MMM d, yyyy · h:mm a")}
                {m.location ? ` · ${m.location}` : ""}
              </CardContent>
            </Card>
          </section>
        )
      })()}

      {/* Schedule control for privileged roles */}
      {isPrivileged && item.status !== "presented" && item.status !== "archived" && (
        <ScheduleControl
          itemId={item.id}
          currentMeetingId={item.scheduled_meeting_id}
          status={item.status}
          upcomingMeetings={(upcomingMeetings ?? []).filter(
            (m) => m.status === "upcoming" || m.status === "in_progress"
          )}
        />
      )}

      <section className="flex flex-wrap gap-2 pt-2">
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            render={<Link href={`/forum/parking-lot/${id}/edit`} />}
          >
            Edit
          </Button>
        )}
        {isPrivileged &&
          (item.status === "parked" || item.status === "scheduled") && (
            <MarkDiscussedButton itemId={item.id} />
          )}
        {isEditable && (
          <form action={withdraw}>
            <Button size="sm" variant="outline" type="submit">
              Withdraw
            </Button>
          </form>
        )}
        {isClosed && (
          <form action={repark}>
            <Button size="sm" variant="outline" type="submit">
              Re-park
            </Button>
          </form>
        )}
      </section>
    </div>
  )
}
