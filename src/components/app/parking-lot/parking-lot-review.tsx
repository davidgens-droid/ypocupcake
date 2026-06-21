"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GitMerge, Trash2, Check, X, Sparkles, Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import {
  deleteCapturedItem,
  parkCapturedItem,
  mergeCapturedIntoParked,
  updateCapturedItem,
} from "@/lib/parking-lot/actions"
import type { FormatOption } from "@/components/app/meeting/capture-topic-button"

export type ReviewItem = {
  id: string
  topic: string
  context: string | null
  urgency: "low" | "med" | "high"
  tool_category: "EQ" | "IQ"
  exploration_format: string
  submitter_member_id: string
}

type Props = {
  captured: ReviewItem[]
  parked: ReviewItem[]
  memberName: Record<string, string>
  formatLabel: Record<string, string>
  formats: FormatOption[]
}

export function ParkingLotReview({
  captured,
  parked,
  memberName,
  formatLabel,
  formats,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Which captured item is choosing a merge target (null = not merging).
  const [mergingId, setMergingId] = useState<string | null>(null)

  function run(work: () => Promise<void>, successMsg: string) {
    startTransition(async () => {
      try {
        await work()
        toast.success(successMsg)
        setMergingId(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed.")
      }
    })
  }

  const mergingItem = captured.find((c) => c.id === mergingId) ?? null

  if (captured.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing was captured during this meeting — nothing to review.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {mergingItem && (
        <div className="flex items-center gap-2 rounded-lg border border-foreground/30 bg-muted/40 p-3 text-sm">
          <GitMerge className="size-4 shrink-0" />
          <span>
            Pick a parked topic on the right to merge{" "}
            <strong>“{mergingItem.topic}”</strong> into. AI will combine them.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setMergingId(null)}
            disabled={pending}
          >
            <X className="size-4" /> Cancel
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Added during this meeting */}
        <section className="space-y-2">
          <h2 className="font-heading text-sm font-semibold">
            Added during this meeting ({captured.length})
          </h2>
          <ul className="space-y-2">
            {captured.map((item) => {
              const isMerging = item.id === mergingId
              return (
                <li key={item.id}>
                  <Card className={cn(isMerging && "ring-2 ring-foreground")}>
                    <CardContent className="space-y-2 py-3">
                      <ItemBody
                        item={item}
                        memberName={memberName}
                        formatLabel={formatLabel}
                      />
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => parkCapturedItem(item.id),
                              "Kept in the parking lot."
                            )
                          }
                        >
                          <Check className="size-4" /> Keep
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || parked.length === 0}
                          onClick={() =>
                            setMergingId(isMerging ? null : item.id)
                          }
                          title={
                            parked.length === 0
                              ? "No parked topics to merge into"
                              : undefined
                          }
                        >
                          <GitMerge className="size-4" />
                          {isMerging ? "Choosing…" : "Merge"}
                        </Button>
                        <EditCapturedDialog
                          item={item}
                          formats={formats}
                          canMerge={parked.length > 0}
                          onRequestMerge={(id) => setMergingId(id)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => deleteCapturedItem(item.id),
                              "Deleted."
                            )
                          }
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>

        {/* Already parked */}
        <section className="space-y-2">
          <h2 className="font-heading text-sm font-semibold">
            Already parked ({parked.length})
          </h2>
          {parked.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing was parked before this meeting.
            </p>
          ) : (
            <ul className="space-y-2">
              {parked.map((item) => (
                <li key={item.id}>
                  {mergingItem ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            mergeCapturedIntoParked({
                              capturedId: mergingItem.id,
                              targetId: item.id,
                            }),
                          "Merged."
                        )
                      }
                      className="block w-full rounded-lg border border-foreground/40 bg-card text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
                    >
                      <div className="space-y-2 p-3">
                        <ItemBody
                          item={item}
                          memberName={memberName}
                          formatLabel={formatLabel}
                        />
                        <p className="flex items-center gap-1 text-xs font-medium text-foreground">
                          <Sparkles className="size-3" />
                          {pending ? "Merging…" : "Merge into this topic"}
                        </p>
                      </div>
                    </button>
                  ) : (
                    <Card>
                      <CardContent className="space-y-2 py-3">
                        <ItemBody
                          item={item}
                          memberName={memberName}
                          formatLabel={formatLabel}
                        />
                      </CardContent>
                    </Card>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function EditCapturedDialog({
  item,
  formats,
  canMerge,
  onRequestMerge,
}: {
  item: ReviewItem
  formats: FormatOption[]
  canMerge: boolean
  onRequestMerge: (id: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState(item.topic)
  const [context, setContext] = useState(item.context ?? "")
  const [urgency, setUrgency] = useState<"low" | "med" | "high">(item.urgency)
  const [formatCode, setFormatCode] = useState(item.exploration_format)
  const [pending, startTransition] = useTransition()

  function onOpenChange(next: boolean) {
    if (next) {
      // Reset to the latest values each time it opens.
      setTopic(item.topic)
      setContext(item.context ?? "")
      setUrgency(item.urgency)
      setFormatCode(item.exploration_format)
    }
    setOpen(next)
  }

  const fields = () => ({
    itemId: item.id,
    topic,
    context,
    urgency,
    exploration_format: formatCode,
  })

  function act(work: () => Promise<void>, msg: string, thenMerge = false) {
    if (topic.trim().length < 2) {
      toast.error("Topic can't be empty.")
      return
    }
    startTransition(async () => {
      try {
        await work()
        toast.success(msg)
        setOpen(false)
        if (thenMerge) onRequestMerge(item.id)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed.")
      }
    })
  }

  const formatLabel =
    formats.find((f) => f.code === formatCode)?.display_name ?? "Pick a format"
  const urgencyLabel = { low: "Low", med: "Medium", high: "High" }[urgency]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="ghost" className="gap-1" />}>
        <Pencil className="size-4" /> Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit captured topic</DialogTitle>
          <DialogDescription>
            Refine it, then keep, merge, or delete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`edit-topic-${item.id}`}>Topic</Label>
            <Input
              id={`edit-topic-${item.id}`}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-context-${item.id}`}>Context</Label>
            <Textarea
              id={`edit-context-${item.id}`}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Urgency</Label>
              <Select
                value={urgency}
                onValueChange={(v) =>
                  setUrgency((v as "low" | "med" | "high") ?? urgency)
                }
              >
                <SelectTrigger className="w-full">
                  <span data-slot="select-value">{urgencyLabel}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="med">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
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
        </div>

        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                act(
                  () => updateCapturedItem(fields()).then(() => parkCapturedItem(item.id)),
                  "Kept in the parking lot."
                )
              }
            >
              <Check className="size-4" /> Keep
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canMerge}
              title={canMerge ? undefined : "No parked topics to merge into"}
              onClick={() =>
                act(
                  () => updateCapturedItem(fields()),
                  "Saved — now pick a topic to merge into.",
                  true
                )
              }
            >
              <GitMerge className="size-4" /> Merge…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              disabled={pending}
              onClick={() => act(() => deleteCapturedItem(item.id), "Deleted.")}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                act(() => updateCapturedItem(fields()), "Saved.")
              }
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ItemBody({
  item,
  memberName,
  formatLabel,
}: {
  item: ReviewItem
  memberName: Record<string, string>
  formatLabel: Record<string, string>
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase">
          {item.tool_category}
        </span>
        <span>{formatLabel[item.exploration_format] ?? item.exploration_format}</span>
        <span className="capitalize">· {item.urgency}</span>
      </div>
      <p className="text-sm font-medium">{item.topic}</p>
      {item.context && (
        <p className="line-clamp-3 text-xs text-muted-foreground whitespace-pre-line">
          {item.context}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        For {memberName[item.submitter_member_id] ?? "—"}
      </p>
    </div>
  )
}
