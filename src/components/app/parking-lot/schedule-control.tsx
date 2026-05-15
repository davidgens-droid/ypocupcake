"use client"

import { useState, useTransition } from "react"
import { CalendarClock, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  scheduleParkingLotItem,
  unscheduleParkingLotItem,
} from "@/lib/parking-lot/actions"
import { formatMeeting } from "@/lib/dates"

type MeetingChoice = {
  id: string
  scheduled_at: string
  location: string | null
}

type Props = {
  itemId: string
  currentMeetingId: string | null
  status: string
  upcomingMeetings: MeetingChoice[]
}

export function ScheduleControl({
  itemId,
  currentMeetingId,
  status,
  upcomingMeetings,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [picked, setPicked] = useState<string>(
    currentMeetingId ?? upcomingMeetings[0]?.id ?? ""
  )

  function onSchedule() {
    if (!picked) return
    startTransition(async () => {
      try {
        await scheduleParkingLotItem({ itemId, meetingId: picked })
        toast.success("Scheduled.")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't schedule.")
      }
    })
  }

  function onUnschedule() {
    startTransition(async () => {
      try {
        await unscheduleParkingLotItem(itemId)
        toast.success("Returned to Parked.")
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't unschedule."
        )
      }
    })
  }

  if (upcomingMeetings.length === 0 && status !== "scheduled") {
    return (
      <p className="text-xs text-muted-foreground">
        No upcoming meetings to schedule into. Add one in{" "}
        <code>/admin/meetings</code>.
      </p>
    )
  }

  const pickedLabel = (() => {
    const m = upcomingMeetings.find((x) => x.id === picked)
    if (!m) return "Pick a meeting"
    return `${formatMeeting(m.scheduled_at, "EEE MMM d, yyyy · h:mm a")}${m.location ? ` · ${m.location}` : ""}`
  })()

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="size-4" />
        Schedule for a meeting
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={picked} onValueChange={(v) => setPicked(v ?? picked)}>
          <SelectTrigger className="w-full">
            <span data-slot="select-value">{pickedLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {upcomingMeetings.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {formatMeeting(m.scheduled_at, "EEE MMM d, yyyy · h:mm a")}
                {m.location ? ` · ${m.location}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onSchedule}
            disabled={pending || !picked || picked === currentMeetingId}
          >
            {pending
              ? "Saving…"
              : status === "scheduled"
                ? "Move"
                : "Schedule"}
          </Button>
          {status === "scheduled" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onUnschedule}
              disabled={pending}
              className="gap-1 text-destructive hover:bg-destructive/10"
            >
              <X className="size-3" /> Unschedule
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
