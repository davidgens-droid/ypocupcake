"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveForumSettings } from "@/lib/admin/actions"

type Props = {
  name: string
  timezone: string
  /** IANA zone names, computed on the server so SSR and hydration agree. */
  timezones: string[]
}

export function ForumSettingsForm({ name, timezone, timezones }: Props) {
  const router = useRouter()
  const [forumName, setForumName] = useState(name)
  const [tz, setTz] = useState(timezone)
  const [pending, startTransition] = useTransition()

  // A zone the runtime doesn't list (an old alias, say) must still be
  // selectable, or the form would silently change it on first save.
  const options = timezones.includes(timezone) ? timezones : [timezone, ...timezones]
  const dirty = forumName.trim() !== name || tz !== timezone

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const res = await saveForumSettings({ name: forumName, timezone: tz })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success("Settings saved.")
        router.refresh()
      } catch {
        toast.error("Couldn't save. Check your connection and try again.")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forum-name">Forum name</Label>
        <Input
          id="forum-name"
          value={forumName}
          onChange={(e) => setForumName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
          autoComplete="organization"
        />
        <p className="text-xs text-muted-foreground">
          Shown in the sidebar, on printed updates, and in the subject line of
          update emails.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="forum-timezone">Timezone</Label>
        <select
          id="forum-timezone"
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {options.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Meeting times are entered and shown in this zone. Changing it never
          moves an existing meeting — the same moment is just shown in the new
          zone.
        </p>
      </div>

      <Button type="submit" disabled={pending || !dirty}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  )
}
