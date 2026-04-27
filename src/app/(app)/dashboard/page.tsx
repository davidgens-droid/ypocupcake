import Link from "next/link"
import { format, parseISO } from "date-fns"
import {
  ArrowRight,
  Sparkles,
  Calendar,
  AlertTriangle,
  Image as ImageIcon,
  PlusCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

function daysUntil(iso: string): number {
  const ms = parseISO(iso).getTime() - Date.now()
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

export default async function DashboardPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const today = new Date()
  const [
    { data: nextMeeting },
    { data: openCommitments },
    { data: roles },
  ] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, status")
      .or(
        `scheduled_at.gte.${today.toISOString()},status.eq.in_progress`
      )
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("commitments")
      .select("id, text, due_date")
      .eq("member_id", me.id)
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from("roles")
      .select("role_type")
      .eq("member_id", me.id)
      .eq("year", today.getFullYear()),
  ])

  const isModerator = (roles ?? []).some((r) =>
    ["moderator", "assistant_moderator"].includes(r.role_type)
  )

  const greetingName = me.name.split(" ")[0]

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Good {today.getHours() < 12 ? "morning" : today.getHours() < 18 ? "afternoon" : "evening"},{" "}
          {greetingName}
        </p>
        {nextMeeting ? (
          <>
            <h1 className="font-heading text-2xl font-semibold">
              {format(parseISO(nextMeeting.scheduled_at), "EEE MMM d")} ·{" "}
              {format(parseISO(nextMeeting.scheduled_at), "h:mm a")}
            </h1>
            <p className="text-sm text-muted-foreground">
              <Calendar className="mr-1 inline size-3.5" />
              {nextMeeting.location ?? "TBD"} ·{" "}
              {daysUntil(nextMeeting.scheduled_at)} days away
            </p>
          </>
        ) : (
          <h1 className="font-heading text-2xl font-semibold">
            No meeting scheduled
          </h1>
        )}
      </header>

      {/* Meeting access (when in progress) */}
      {nextMeeting?.status === "in_progress" && (
        <Card className="border-foreground">
          <CardHeader>
            <CardTitle className="text-base">Meeting in progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              size="lg"
              className="w-full"
              render={
                <Link
                  href={
                    isModerator || me.is_admin
                      ? `/meeting/${nextMeeting.id}/run`
                      : `/meeting/${nextMeeting.id}`
                  }
                />
              }
            >
              {isModerator || me.is_admin
                ? "Open meeting room (Moderator)"
                : "Join meeting"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Update CTA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {nextMeeting
              ? "Your update is not started"
              : "When a meeting is scheduled, your update will live here"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            disabled={!nextMeeting}
            render={<Link href="/me/update" />}
          >
            Start your update <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-2"
            disabled={!nextMeeting}
            render={<Link href="/me/update?ai=brain-dump" />}
          >
            <Sparkles className="size-4" />
            Brain-dump with AI
          </Button>
          {nextMeeting?.status === "upcoming" && (isModerator || me.is_admin) && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit gap-2"
              render={<Link href={`/meeting/${nextMeeting.id}/run`} />}
            >
              Open meeting setup
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Open commitments */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">
            Open commitments
          </h2>
          <Link
            href="/forum/commitments"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </div>

        {openCommitments && openCommitments.length > 0 ? (
          <div className="grid gap-2">
            {openCommitments.map((c) => {
              const overdue = c.due_date && parseISO(c.due_date) < today
              return (
                <Card key={c.id}>
                  <CardContent className="flex items-start justify-between gap-2 py-3">
                    <div className="space-y-1">
                      <p className="text-sm">{c.text}</p>
                      {c.due_date && (
                        <p className="text-xs text-muted-foreground">
                          {overdue ? (
                            <span className="text-destructive">
                              <AlertTriangle className="mr-1 inline size-3" />
                              Overdue · due {format(parseISO(c.due_date), "MMM d")}
                            </span>
                          ) : (
                            <>Due {format(parseISO(c.due_date), "MMM d")}</>
                          )}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/forum/commitments/${c.id}`} />}
                    >
                      Update
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No open commitments. They appear here after each meeting.
          </p>
        )}
      </section>

      <Separator />

      {/* Quick actions */}
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/forum/parking-lot/new" />}
          >
            <PlusCircle className="size-4" /> Park a topic
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/forum/photos" />}
          >
            <ImageIcon className="size-4" /> Upload photo
          </Button>
        </div>
      </section>
    </div>
  )
}
