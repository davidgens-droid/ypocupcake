"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { updateCommitment } from "@/lib/commitments/actions"

type Props = {
  id: string
  initialStatus: "open" | "done" | "carried_over" | "dropped"
  initialNotes: string
}

const OPTIONS: Array<[
  "open" | "done" | "carried_over" | "dropped",
  string,
]> = [
  ["open", "Open — still working on it"],
  ["done", "Done"],
  ["carried_over", "Carrying over to next month"],
  ["dropped", "Dropped — no longer pursuing"],
]

export function CommitmentStatusForm({ id, initialStatus, initialNotes }: Props) {
  const [status, setStatus] = useState(initialStatus)
  const [notes, setNotes] = useState(initialNotes)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData()
    fd.set("id", id)
    fd.set("status", status)
    fd.set("notes", notes)
    startTransition(async () => {
      try {
        await updateCommitment(fd)
        toast.success("Commitment updated.")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update.")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Status</Label>
        <RadioGroup
          value={status}
          onValueChange={(v) =>
            setStatus(
              (v as "open" | "done" | "carried_over" | "dropped") ?? status
            )
          }
          className="grid gap-2"
        >
          {OPTIONS.map(([k, label]) => (
            <label
              key={k}
              className="flex items-start gap-2 rounded-lg border p-2 text-sm"
            >
              <RadioGroupItem value={k} />
              <span>{label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes" className="text-sm">
          Notes (visible to forum)
        </Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  )
}
