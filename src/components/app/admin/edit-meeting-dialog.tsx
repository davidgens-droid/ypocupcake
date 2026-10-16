"use client"

import { useState, useTransition } from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { updateMeeting } from "@/lib/admin/actions"
import { DATETIME_LOCAL_FORMAT, formatMeeting } from "@/lib/dates"

type Member = { id: string; name: string }

type Props = {
  meeting: {
    id: string
    scheduled_at: string
    location: string | null
    host_member_id: string | null
    status: string
  }
  members: Member[]
  /**
   * The forum's IANA timezone. The datetime-local input shows and is saved
   * as wall-clock time in THIS zone (updateMeeting parses it that way), so
   * the value must be rendered in it too — not in the admin's browser zone,
   * or an admin travelling would shift every meeting they touched.
   */
  timezone: string
}

export function EditMeetingDialog({ meeting, members, timezone }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [scheduledAt, setScheduledAt] = useState(
    formatMeeting(meeting.scheduled_at, DATETIME_LOCAL_FORMAT, timezone)
  )
  const [location, setLocation] = useState(meeting.location ?? "")
  const [hostId, setHostId] = useState(meeting.host_member_id ?? "")
  const [status, setStatus] = useState(meeting.status)

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData()
    fd.set("id", meeting.id)
    fd.set("scheduled_at_local", scheduledAt)
    fd.set("location", location)
    fd.set("host_member_id", hostId)
    fd.set("status", status)
    startTransition(async () => {
      try {
        await updateMeeting(fd)
        toast.success("Meeting updated.")
        setOpen(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update.")
      }
    })
  }

  const hostLabel =
    members.find((m) => m.id === hostId)?.name ?? "Unassigned"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost" title="Edit meeting" />
        }
      >
        <Pencil className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit meeting</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`scheduled_at_${meeting.id}`}>Date & time</Label>
            <Input
              id={`scheduled_at_${meeting.id}`}
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`location_${meeting.id}`}>Location</Label>
            <Input
              id={`location_${meeting.id}`}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Host</Label>
            <Select value={hostId} onValueChange={(v) => setHostId(v ?? "")}>
              <SelectTrigger className="w-full">
                <span data-slot="select-value">{hostLabel}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Unassigned —</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? status)}>
              <SelectTrigger className="w-full">
                <span data-slot="select-value">{status}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">upcoming</SelectItem>
                <SelectItem value="in_progress">in_progress</SelectItem>
                <SelectItem value="closed">closed</SelectItem>
                <SelectItem value="cancelled">cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
