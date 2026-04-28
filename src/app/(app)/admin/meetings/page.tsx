import { parseISO } from "date-fns"
import { CalendarPlus, Trash2 } from "lucide-react"

import { formatMeeting } from "@/lib/dates"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  createMeeting,
  deleteMeeting,
} from "@/lib/admin/actions"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminMeetingsPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const [{ data: meetings }, { data: members }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, scheduled_at, location, host_member_id, status")
      .eq("forum_id", me.forum_id)
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("members")
      .select("id, name")
      .eq("forum_id", me.forum_id)
      .order("name"),
  ])

  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))
  const now = new Date()
  const upcoming = (meetings ?? []).filter(
    (m) => parseISO(m.scheduled_at) >= now && m.status !== "cancelled"
  )
  const past = (meetings ?? [])
    .filter((m) => parseISO(m.scheduled_at) < now || m.status === "cancelled")
    .reverse() // most recent past meeting first

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">
          New meeting
        </h2>
        <Card>
          <CardContent className="py-4">
            <form action={createMeeting} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="scheduled_at_local">Date & time</Label>
                <Input
                  id="scheduled_at_local"
                  name="scheduled_at_local"
                  type="datetime-local"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" placeholder="Bryan's home" />
              </div>
              <div className="space-y-2">
                <Label>Host</Label>
                <Select name="host_member_id">
                  <SelectTrigger className="w-full">
                    <span data-slot="select-value">Pick a host</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">— Unassigned —</SelectItem>
                    {(members ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit">
                  <CalendarPlus className="size-4" /> Schedule meeting
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No meetings scheduled.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                hostName={
                  m.host_member_id ? memberName.get(m.host_member_id) : null
                }
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-semibold">
            Past ({past.length})
          </h2>
          <ul className="space-y-2">
            {past.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                hostName={
                  m.host_member_id ? memberName.get(m.host_member_id) : null
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

type MeetingRowProps = {
  meeting: {
    id: string
    scheduled_at: string
    location: string | null
    host_member_id: string | null
    status: string
  }
  hostName: string | null | undefined
}

function MeetingRow({ meeting, hostName }: MeetingRowProps) {
  return (
    <li>
      <Card>
        <CardContent className="flex items-start justify-between gap-2 py-3 text-sm">
          <div className="space-y-0.5">
            <p className="font-medium">
              {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy · h:mm a")}
            </p>
            <p className="text-xs text-muted-foreground">
              📍 {meeting.location ?? "TBD"}
              {hostName && ` · Host: ${hostName}`} ·{" "}
              <span className="uppercase tracking-wide">{meeting.status}</span>
            </p>
          </div>
          <form action={deleteMeeting}>
            <input type="hidden" name="id" value={meeting.id} />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              title="Delete meeting"
            >
              <Trash2 className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </li>
  )
}
