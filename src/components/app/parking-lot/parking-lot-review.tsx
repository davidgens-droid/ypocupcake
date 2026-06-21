"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GitMerge, Trash2, Check, X, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  deleteCapturedItem,
  parkCapturedItem,
  mergeCapturedIntoParked,
} from "@/lib/parking-lot/actions"

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
}

export function ParkingLotReview({
  captured,
  parked,
  memberName,
  formatLabel,
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
