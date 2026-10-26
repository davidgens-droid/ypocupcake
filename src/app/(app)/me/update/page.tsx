import Link from "next/link"
import { formatMeeting, meetingPastCutoffISO } from "@/lib/dates"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { UpdateBuilderGate, type EncryptedUpdateRow } from "@/components/app/update-builder/update-builder-gate"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { ExplorationFormat } from "@/lib/types/domain"

// The AI brain-dump (a Server Action invoked from this page) calls Claude
// with adaptive thinking, which can take 20–60s on a long dump. Server
// Actions inherit maxDuration from the page they're invoked on.
export const maxDuration = 120

type Row = {
  meeting_id: string
  content_enc: string | null
  content: unknown | null
  ready?: boolean
  completed_at?: string | null
  qol_physical: number | null
  qol_mental: number | null
  qol_financial: number | null
  qol_friends: number | null
}

const toRow = (r: Row): EncryptedUpdateRow => ({ meetingId: r.meeting_id, envelope: r.content_enc, legacy: r.content })

/** QoL scores from the columns; a not-yet-migrated row still has them inside its readable content. */
function qolOf(r: Row): Record<string, number> | null {
  if (r.qol_physical != null && r.qol_mental != null && r.qol_financial != null && r.qol_friends != null) {
    return { physical_health: r.qol_physical, mental_health: r.qol_mental, financial_health: r.qol_financial, friends_community: r.qol_friends }
  }
  const legacy = (r.content as { qol?: Record<string, number> } | null)?.qol
  return legacy ?? null
}

export default async function UpdatePage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const { data: nextMeeting } = await supabase
    .from("meetings")
    .select("id, scheduled_at, location")
    .gte("scheduled_at", meetingPastCutoffISO())
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextMeeting) {
    return <NoMeetingState />
  }

  const [{ data: existingUpdate }, { data: formatsRaw }, { data: pastUpdates }] = await Promise.all([
    supabase
      .from("updates")
      .select("meeting_id, content_enc, content, ready, qol_physical, qol_mental, qol_financial, qol_friends")
      .eq("member_id", me.id)
      .eq("meeting_id", nextMeeting.id)
      .maybeSingle(),
    supabase
      .from("exploration_formats")
      .select("code, category, display_name, default_minutes, short_description, moderator_instructions, source_attribution"),
    supabase
      .from("updates")
      .select("meeting_id, content_enc, content, completed_at, qol_physical, qol_mental, qol_financial, qol_friends")
      .eq("member_id", me.id)
      .neq("meeting_id", nextMeeting.id)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(6),
  ])

  const formats = (formatsRaw ?? []) as ExplorationFormat[]
  const past = (pastUpdates ?? []) as Row[]

  // Past QoL values for sparklines (oldest → newest) — metadata, no decryption needed.
  const qolHistory = [...past].reverse().map(qolOf).filter(Boolean) as Array<Record<string, number>>

  const meetingLabel = formatMeeting(nextMeeting.scheduled_at, "EEE MMM d", me.forum.timezone)

  return (
    <UpdateBuilderGate
      member={{ id: me.id, email: me.email, name: me.name, forumName: me.forum.name }}
      meetingId={nextMeeting.id}
      meetingLabel={meetingLabel}
      current={existingUpdate ? toRow(existingUpdate as Row) : null}
      initialReady={existingUpdate?.ready ?? false}
      formats={formats}
      qolHistory={qolHistory}
      recent={past.slice(0, 3).map(toRow)}
      // Interview questions are voiced by OpenAI when a key is configured;
      // otherwise the browser's own voice.
      naturalVoice={!!process.env.OPENAI_API_KEY}
    />
  )
}

function NoMeetingState() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No upcoming meeting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Updates are tied to a specific meeting. Once a meeting is on the
            calendar, you&apos;ll be able to start your update here.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" render={<Link href="/me/history" />}>
              View past updates
            </Button>
            <Button variant="ghost" size="sm" render={<Link href="/dashboard" />}>
              Back to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
