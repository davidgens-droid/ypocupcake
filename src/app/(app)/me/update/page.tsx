import Link from "next/link"
import { format, parseISO } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { UpdateBuilder } from "@/components/app/update-builder/update-builder"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"
import type { ExplorationFormat } from "@/lib/types/domain"

export default async function UpdatePage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const { data: nextMeeting } = await supabase
    .from("meetings")
    .select("id, scheduled_at, location")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!nextMeeting) {
    return <NoMeetingState />
  }

  const [
    { data: existingUpdate },
    { data: formatsRaw },
    { data: pastUpdates },
  ] = await Promise.all([
    supabase
      .from("updates")
      .select("content, ready")
      .eq("member_id", me.id)
      .eq("meeting_id", nextMeeting.id)
      .maybeSingle(),
    supabase
      .from("exploration_formats")
      .select(
        "code, category, display_name, default_minutes, short_description, moderator_instructions, source_attribution"
      ),
    supabase
      .from("updates")
      .select("content, completed_at, meeting_id")
      .eq("member_id", me.id)
      .neq("meeting_id", nextMeeting.id)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(6),
  ])

  const formats = (formatsRaw ?? []) as ExplorationFormat[]

  // Pull past QoL values for sparklines (oldest → newest).
  const qolHistory = (pastUpdates ?? [])
    .reverse()
    .map((u) => {
      const c = u.content as { qol?: Record<string, number> } | null
      return c?.qol ?? null
    })
    .filter(Boolean) as Array<Record<string, number>>

  let initialContent: UpdateContent = emptyUpdateContent
  if (existingUpdate?.content) {
    const parsed = updateContentSchema.safeParse(existingUpdate.content)
    if (parsed.success) initialContent = parsed.data
  }

  const meetingLabel = format(parseISO(nextMeeting.scheduled_at), "EEE MMM d")

  return (
    <UpdateBuilder
      meetingId={nextMeeting.id}
      meetingLabel={meetingLabel}
      initialContent={initialContent}
      initialReady={existingUpdate?.ready ?? false}
      formats={formats}
      qolHistory={qolHistory}
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
          <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
