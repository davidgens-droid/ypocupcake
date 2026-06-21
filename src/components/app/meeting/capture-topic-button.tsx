"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PlusCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { captureParkingLotItem } from "@/lib/parking-lot/actions"

export type FormatOption = {
  code: string
  display_name: string
  category?: string
}

type Props = {
  meetingId: string
  presenterMemberId: string
  presenterName: string
  formats: FormatOption[]
  /** "outline" (runner) or "ghost" (member view) */
  variant?: "outline" | "ghost"
}

const DEFAULT_FORMAT = "fsfe" // Four-Step Forum Exploration

export function CaptureTopicButton({
  meetingId,
  presenterMemberId,
  presenterName,
  formats,
  variant = "outline",
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState("")
  const [context, setContext] = useState("")
  const [formatCode, setFormatCode] = useState<string>(
    formats.some((f) => f.code === DEFAULT_FORMAT)
      ? DEFAULT_FORMAT
      : formats[0]?.code ?? DEFAULT_FORMAT
  )
  const [pending, startTransition] = useTransition()

  const firstName = presenterName.split(" ")[0]
  const formatLabel =
    formats.find((f) => f.code === formatCode)?.display_name ?? "Pick a format"

  function onSave() {
    if (topic.trim().length < 2) {
      toast.error("Add a short topic first.")
      return
    }
    startTransition(async () => {
      try {
        await captureParkingLotItem({
          meetingId,
          presenterMemberId,
          topic,
          context,
          exploration_format: formatCode,
        })
        toast.success(`Parked a topic for ${firstName}.`)
        setTopic("")
        setContext("")
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant={variant} className="gap-1.5" />
        }
      >
        <PlusCircle className="size-4" /> Park a topic for {firstName}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Park a topic for {presenterName}</DialogTitle>
          <DialogDescription>
            Captured against this meeting. You&apos;ll review everything added
            tonight — keep, merge, or discard — once the meeting wraps.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="capture-topic">Topic</Label>
            <Input
              id="capture-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={500}
              placeholder="e.g. Succession planning for the family business"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-context">Context (optional)</Label>
            <Textarea
              id="capture-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anything that would help frame it later."
            />
          </div>
          <div className="space-y-2">
            <Label>Exploration type</Label>
            <Select
              value={formatCode}
              onValueChange={(v) => setFormatCode(v ?? formatCode)}
            >
              <SelectTrigger className="w-full">
                <span data-slot="select-value">{formatLabel}</span>
              </SelectTrigger>
              <SelectContent>
                {formats.map((f) => (
                  <SelectItem key={f.code} value={f.code}>
                    {f.display_name}
                    {f.category ? ` · ${f.category}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <Button type="button" onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Park topic"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
