"use server"

import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { formatMeeting } from "@/lib/dates"
import { createClient } from "@/lib/supabase/server"

export type UpdateExportMeta = {
  memberName: string
  forumName: string
  meetingDate: string
  location: string | null
  completedAt: string | null
  ready: boolean
  /** exploration format code → "Name · 20m" */
  formatLabels: Record<string, string>
}

/**
 * Everything a printed / PDF update needs besides its (device-decrypted)
 * content: names, dates, format labels. Metadata only.
 */
export async function getUpdateExportMeta(meetingId: string): Promise<UpdateExportMeta | null> {
  const me = await requireCurrentMember()
  const parsed = z.string().uuid().safeParse(meetingId)
  if (!parsed.success) return null
  const supabase = await createClient()
  const [{ data: meeting }, { data: update }, { data: formats }] = await Promise.all([
    supabase.from("meetings").select("scheduled_at, location").eq("id", parsed.data).maybeSingle(),
    supabase
      .from("updates")
      .select("ready, completed_at")
      .eq("meeting_id", parsed.data)
      .eq("member_id", me.id)
      .maybeSingle(),
    supabase.from("exploration_formats").select("code, display_name, default_minutes"),
  ])
  if (!meeting) return null
  return {
    memberName: me.name,
    forumName: me.forum.name,
    meetingDate: formatMeeting(meeting.scheduled_at, "EEE, MMM d, yyyy", me.forum.timezone),
    location: meeting.location,
    completedAt: update?.completed_at ?? null,
    ready: update?.ready ?? false,
    formatLabels: Object.fromEntries(
      (formats ?? []).map((f) => [f.code, `${f.display_name} · ${f.default_minutes}m`])
    ),
  }
}
