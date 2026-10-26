import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft } from "lucide-react"
import { notFound } from "next/navigation"

import { PastUpdateBody } from "@/components/app/update-view/past-update-body"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { UpdateExportMeta } from "@/lib/updates/export-meta"

type Params = Promise<{ meetingId: string }>

/** Server shell: metadata only. The update itself is decrypted on the device. */
export default async function PastUpdatePage({ params }: { params: Params }) {
  const me = await requireCurrentMember()
  const { meetingId } = await params
  const supabase = await createClient()

  const [{ data: meeting }, { data: update }, { data: formats }] = await Promise.all([
    supabase.from("meetings").select("id, scheduled_at, location").eq("id", meetingId).maybeSingle(),
    supabase
      .from("updates")
      .select("content, content_enc, ready, completed_at, updated_at")
      .eq("meeting_id", meetingId)
      .eq("member_id", me.id)
      .maybeSingle(),
    supabase.from("exploration_formats").select("code, display_name, default_minutes"),
  ])

  if (!meeting) notFound()
  if (!update) notFound()

  const meta: UpdateExportMeta = {
    memberName: me.name,
    forumName: me.forum.name,
    meetingDate: formatMeeting(meeting.scheduled_at, "EEE, MMM d, yyyy", me.forum.timezone),
    location: meeting.location,
    completedAt: update.completed_at,
    ready: update.ready,
    formatLabels: Object.fromEntries((formats ?? []).map((f) => [f.code, `${f.display_name} · ${f.default_minutes}m`])),
  }
  const status = update.completed_at ? (update.ready ? "Ready" : "Finalized") : "Draft"

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button size="sm" variant="ghost" render={<Link href="/me/history" />}>
        <ChevronLeft className="size-4" /> Past updates
      </Button>

      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy", me.forum.timezone)}
        </h1>
        <p className="text-sm text-muted-foreground">
          📍 {meeting.location ?? "TBD"} · <Badge variant={status === "Draft" ? "outline" : "default"}>{status}</Badge>
          {update.completed_at && <> · finalized {format(parseISO(update.completed_at), "MMM d, yyyy")}</>}
          {" · last edited "}
          {format(parseISO(update.updated_at), "MMM d, yyyy 'at' h:mm a")}
        </p>
      </header>

      <PastUpdateBody
        member={{ id: me.id, email: me.email, name: me.name, forumName: me.forum.name }}
        meetingId={meeting.id}
        envelope={update.content_enc}
        legacy={update.content}
        meta={meta}
      />
    </div>
  )
}
