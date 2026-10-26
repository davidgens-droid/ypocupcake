import { notFound } from "next/navigation"

import { PrintUpdateClient } from "@/components/app/update-view/print-update-client"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { UpdateExportMeta } from "@/lib/updates/export-meta"

type Params = Promise<{ meetingId: string }>

export const metadata = {
  title: "Cupcake — Update",
}

/** Server shell: metadata only. The update is decrypted, printed and saved on the device. */
export default async function PrintUpdatePage({ params }: { params: Params }) {
  const me = await requireCurrentMember()
  const { meetingId } = await params
  const supabase = await createClient()

  const [{ data: meeting }, { data: update }, { data: formats }] = await Promise.all([
    supabase.from("meetings").select("id, scheduled_at, location").eq("id", meetingId).maybeSingle(),
    supabase
      .from("updates")
      .select("content, content_enc, ready, completed_at")
      .eq("meeting_id", meetingId)
      .eq("member_id", me.id)
      .maybeSingle(),
    supabase.from("exploration_formats").select("code, display_name, default_minutes"),
  ])

  if (!meeting) notFound()

  const meta: UpdateExportMeta = {
    memberName: me.name,
    forumName: me.forum.name,
    meetingDate: formatMeeting(meeting.scheduled_at, "EEE, MMM d, yyyy", me.forum.timezone),
    location: meeting.location,
    completedAt: update?.completed_at ?? null,
    ready: update?.ready ?? false,
    formatLabels: Object.fromEntries((formats ?? []).map((f) => [f.code, `${f.display_name} · ${f.default_minutes}m`])),
  }

  return (
    <PrintUpdateClient
      member={{ id: me.id, email: me.email, name: me.name, forumName: me.forum.name }}
      meetingId={meeting.id}
      envelope={update?.content_enc ?? null}
      legacy={update?.content ?? null}
      meta={meta}
    />
  )
}
