import Link from "next/link"
import { format, parseISO } from "date-fns"

import { formatMeeting, meetingPastCutoffISO } from "@/lib/dates"
import {
  ArrowRight,
  Sparkles,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Circle,
  History,
  Image as ImageIcon,
  PlusCircle,
} from "lucide-react"

import { Suspense } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { PatternCards } from "@/components/app/dashboard/pattern-cards"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { getMyRoles, hasAny } from "@/lib/auth/roles"
import { createClient } from "@/lib/supabase/server"

// Pattern cards are generated inside this page's render (behind Suspense) the
// first time a member's finalized-update count changes. That AI call can run
// 10–60s; without this ceiling the function would be killed at Vercel's short
// default timeout and the whole dashboard would error for that member. Normal
// renders are unaffected — this only raises the limit, it doesn't slow anything.
export const maxDuration = 120

function daysUntil(iso: string): number {
  const ms = parseISO(iso).getTime() - Date.now()
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

function ChecklistItem({ done, href, label, hint }: { done: boolean; href: string; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div>
        {done ? (
          <span className="text-muted-foreground line-through">{label}</span>
        ) : (
          <Link href={href} className="font-medium underline-offset-2 hover:underline">
            {label}
          </Link>
        )}
        {!done && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </li>
  )
}

export default async function DashboardPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const today = new Date()
  const [
    { data: nextMeeting },
    { data: openCommitments },
    roles,
    { count: activeMembers },
    { data: forumRow },
  ] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, status")
      .or(
        `scheduled_at.gte.${meetingPastCutoffISO(today)},status.eq.in_progress`
      )
      .neq("status", "cancelled")
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
    getMyRoles(me),
    // For the first-run checklist (admins of a brand-new forum).
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("forum_id", me.forum_id)
      .eq("status", "active"),
    supabase.from("forums").select("settings").eq("id", me.forum_id).maybeSingle(),
  ])

  const charterWritten =
    typeof (forumRow?.settings as { charter?: unknown } | null)?.charter === "string" &&
    ((forumRow?.settings as { charter: string }).charter.trim().length > 0)
  const firstRun = me.is_admin && ((activeMembers ?? 0) < 2 || !nextMeeting || !charterWritten)

  const { data: existingUpdate } = nextMeeting
    ? await supabase
        .from("updates")
        .select("ready, completed_at")
        .eq("member_id", me.id)
        .eq("meeting_id", nextMeeting.id)
        .maybeSingle()
    : { data: null }

  const isModerator = hasAny(roles, "moderator", "assistant_moderator")

  const greetingName = me.name.split(" ")[0]
  // The server runs in UTC; greet by the forum's clock, not the server's.
  const forumHour = Number(formatMeeting(today.toISOString(), "H", me.forum.timezone))

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Good {forumHour < 12 ? "morning" : forumHour < 18 ? "afternoon" : "evening"},{" "}
          {greetingName}
        </p>
        {nextMeeting ? (
          <>
            <h1 className="font-heading text-2xl font-semibold">
              {formatMeeting(nextMeeting.scheduled_at, "EEE MMM d", me.forum.timezone)} ·{" "}
              {formatMeeting(nextMeeting.scheduled_at, "h:mm a", me.forum.timezone)}
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

      {/* First-run checklist: the three things a new forum's admin does first */}
      {firstRun && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Getting {me.forum.name} going</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <ChecklistItem done={(activeMembers ?? 0) >= 2} href="/admin/invite" label="Invite your members" hint="Share the forum's invite link." />
              <ChecklistItem done={!!nextMeeting} href="/admin/meetings" label="Schedule your first meeting" hint="Updates live under a meeting." />
              <ChecklistItem done={charterWritten} href="/admin/charter" label="Write your charter" hint="Purpose, confidentiality, attendance." />
            </ul>
          </CardContent>
        </Card>
      )}

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
            {!nextMeeting
              ? "When a meeting is scheduled, your update will live here"
              : !existingUpdate
                ? "Your update is not started"
                : existingUpdate.ready
                  ? "Your update is ready"
                  : existingUpdate.completed_at
                    ? "Your update is finalized"
                    : "Your update is in progress"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            disabled={!nextMeeting}
            render={<Link href="/me/update" />}
          >
            {existingUpdate ? "Open my update" : "Start your update"}{" "}
            <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-2"
            disabled={!nextMeeting}
            render={<Link href="/me/update?ai=brain-dump" />}
          >
            <Sparkles className="size-4" />
            {existingUpdate ? "Refine with AI" : "Brain-dump with AI"}
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
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-2"
            render={<Link href="/me/history" />}
          >
            <History className="size-4" /> View past updates
          </Button>
        </CardContent>
      </Card>

      {/* AI pattern cards (renders nothing until member has 3+ updates) */}
      <Suspense fallback={null}>
        <PatternCards />
      </Suspense>

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
