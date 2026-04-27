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
import {
  mockCurrentMember,
  mockForumActivity,
  mockNextMeeting,
  mockOpenCommitments,
  mockPatternCard,
} from "@/lib/mock-data"

function daysUntil(iso: string): number {
  const ms = parseISO(iso).getTime() - Date.now()
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

export default function DashboardPage() {
  const greetingName = mockCurrentMember.name.split(" ")[0]
  const days = daysUntil(mockNextMeeting.scheduled_at)
  const meetingDate = format(parseISO(mockNextMeeting.scheduled_at), "EEE MMM d")
  const meetingTime = format(parseISO(mockNextMeeting.scheduled_at), "h:mm a")

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Good morning, {greetingName}
        </p>
        <h1 className="font-heading text-2xl font-semibold">
          {meetingDate} · {meetingTime}
        </h1>
        <p className="text-sm text-muted-foreground">
          <Calendar className="mr-1 inline size-3.5" />
          {mockNextMeeting.location} · {days} day{days === 1 ? "" : "s"} away
        </p>
      </header>

      {/* Update CTA */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your update is not started</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            size="lg"
            className="w-full"
            render={<Link href="/me/update" />}
          >
            Start your update <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-2"
            render={<Link href="/me/update?ai=brain-dump" />}
          >
            <Sparkles className="size-4" />
            Brain-dump with AI
          </Button>
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
        <div className="grid gap-2">
          {mockOpenCommitments.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-start justify-between gap-2 py-3">
                <div className="space-y-1">
                  <p className="text-sm">{c.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.overdue ? (
                      <span className="text-destructive">
                        <AlertTriangle className="mr-1 inline size-3" />
                        Overdue · due {format(parseISO(c.due_date), "MMM d")}
                      </span>
                    ) : (
                      <>Due {format(parseISO(c.due_date), "MMM d")}</>
                    )}
                  </p>
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
          ))}
        </div>
      </section>

      {/* AI pattern card */}
      <Card className="border-dashed">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Sparkles className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">AI noticed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{mockPatternCard.title}</p>
          <p className="text-sm text-muted-foreground">
            {mockPatternCard.detail}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm">Park a topic</Button>
            <Button variant="ghost" size="sm">Dismiss</Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Forum activity */}
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold">Forum activity</h2>
        <ul className="space-y-2 text-sm">
          {mockForumActivity.map((a) => (
            <li key={a.id} className="flex items-center justify-between">
              <span>
                <span className="font-medium">{a.who}</span>{" "}
                <span className="text-muted-foreground">{a.what}</span>
              </span>
              <span className="text-xs text-muted-foreground">{a.when}</span>
            </li>
          ))}
        </ul>
      </section>

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
