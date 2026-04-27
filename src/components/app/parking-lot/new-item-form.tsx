"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Info } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { createParkingLotItem } from "@/lib/parking-lot/actions"
import type { ExplorationFormat } from "@/lib/types/domain"

type Member = { id: string; name: string }

type Props = {
  formats: ExplorationFormat[]
  members?: Member[] // present when caller is a Czar
  isCzar: boolean
  defaultSubmitterId?: string
  defaultTopic?: string
}

export function NewItemForm({
  formats,
  members,
  isCzar,
  defaultSubmitterId,
  defaultTopic = "",
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [submitterId, setSubmitterId] = useState(defaultSubmitterId ?? "")
  const [topic, setTopic] = useState(defaultTopic)
  const [context, setContext] = useState("")
  const [urgency, setUrgency] = useState<"low" | "med" | "high">("med")
  const [category, setCategory] = useState<"EQ" | "IQ">("EQ")
  const [formatCode, setFormatCode] = useState<string>(
    formats.find((f) => f.category === "EQ")?.code ?? formats[0]?.code ?? ""
  )

  const filtered = useMemo(
    () => formats.filter((f) => f.category === category),
    [formats, category]
  )
  const activeFormat = filtered.find((f) => f.code === formatCode)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set("urgency", urgency)
    fd.set("tool_category", category)
    fd.set("exploration_format", formatCode)
    if (submitterId) fd.set("submitter_member_id", submitterId)

    startTransition(async () => {
      try {
        await createParkingLotItem(fd)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't park topic."
        )
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {isCzar && members && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            You&apos;re submitting on behalf of another member. The item will
            show &ldquo;added by Czar.&rdquo;
          </p>
          <div className="space-y-1">
            <Label className="text-sm">Submitter</Label>
            <Select
              value={submitterId}
              onValueChange={(v) => setSubmitterId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <span data-slot="select-value">
                  {members.find((m) => m.id === submitterId)?.name ??
                    "Pick a member"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="topic">Topic</Label>
        <Input
          id="topic"
          name="topic"
          required
          maxLength={500}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What would you like to explore?"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="context">Context (optional)</Label>
        <Textarea
          id="context"
          name="context"
          rows={4}
          maxLength={2000}
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Urgency</Label>
        <RadioGroup
          value={urgency}
          onValueChange={(u) => setUrgency(u as "low" | "med" | "high")}
          className="flex gap-4"
        >
          {[
            ["low", "Low"],
            ["med", "Medium"],
            ["high", "High"],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={k} /> {label}
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Exploration type</Label>
        <RadioGroup
          value={category}
          onValueChange={(c) => {
            const cat = c as "EQ" | "IQ"
            setCategory(cat)
            const firstOfCat = formats.find((f) => f.category === cat)
            if (firstOfCat) setFormatCode(firstOfCat.code)
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          <label className="flex items-start gap-2 rounded-lg border p-2 text-sm">
            <RadioGroupItem value="EQ" />
            <div>
              <div className="font-medium">EQ</div>
              <div className="text-xs text-muted-foreground">
                Emotionally complex, &ldquo;feel with&rdquo;
              </div>
            </div>
          </label>
          <label className="flex items-start gap-2 rounded-lg border p-2 text-sm">
            <RadioGroupItem value="IQ" />
            <div>
              <div className="font-medium">IQ</div>
              <div className="text-xs text-muted-foreground">
                Fast, on point, share lessons
              </div>
            </div>
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Format</Label>
          {activeFormat && (
            <Dialog>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <Info className="size-3" /> Tool details
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{activeFormat.display_name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Time: {activeFormat.default_minutes} min · Category:{" "}
                    {activeFormat.category}
                  </p>
                  <p>{activeFormat.short_description}</p>
                  <p className="whitespace-pre-line text-muted-foreground">
                    {activeFormat.moderator_instructions}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Source: {activeFormat.source_attribution}
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <Select
          value={formatCode}
          onValueChange={(v) => setFormatCode(v ?? formatCode)}
        >
          <SelectTrigger className="w-full">
            <span data-slot="select-value">
              {activeFormat
                ? `${activeFormat.display_name} · ${activeFormat.default_minutes}m`
                : "Pick a format"}
            </span>
          </SelectTrigger>
          <SelectContent>
            {filtered.map((f) => (
              <SelectItem key={f.code} value={f.code}>
                {f.display_name} · {f.default_minutes}m
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFormat && (
          <p className="text-xs text-muted-foreground">
            {activeFormat.short_description}
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="ml-auto"
          disabled={pending || !topic.trim() || (isCzar && !submitterId)}
        >
          {pending
            ? "Submitting…"
            : isCzar && submitterId
              ? "Submit on behalf"
              : "Submit topic"}
        </Button>
      </div>
    </form>
  )
}
