"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveCharter } from "@/lib/admin/actions"

/**
 * Charter editor. A client component so the action's result (e.g. "over
 * 50,000 characters", "admins only") reaches the admin as a toast rather
 * than a scrubbed server error page.
 */
export function CharterForm({ initial }: { initial: string }) {
  const router = useRouter()
  const [charter, setCharter] = useState(initial)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const res = await saveCharter({ charter })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success("Charter saved.")
        router.refresh()
      } catch {
        toast.error("Couldn't save. Check your connection and try again.")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="charter">Charter text</Label>
        <Textarea
          id="charter"
          name="charter"
          rows={20}
          value={charter}
          onChange={(e) => setCharter(e.target.value)}
          maxLength={50_000}
          placeholder={`Our purpose\n— Why this forum exists\n\nConfidentiality\n— What stays in forum\n\nAttendance\n— Expectations\n\n…`}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Plain text. Line breaks are preserved when displayed to members.
        </p>
      </div>
      <Button type="submit" disabled={pending || charter === initial}>
        {pending ? "Saving…" : "Save charter"}
      </Button>
    </form>
  )
}
