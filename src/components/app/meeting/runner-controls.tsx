"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  advanceRound,
  closeMeeting,
  startMeeting,
  startRound,
} from "@/lib/meetings/actions"

type Props = {
  meetingId: string
  status: string
  activeRound: {
    id: string
    round_type: string
    order_member_ids: string[]
    current_index: number
    ended_at: string | null
  } | null
  memberName: Record<string, string>
}

export function RunnerControls({
  meetingId,
  status,
  activeRound,
  memberName,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run<T>(work: () => Promise<T>) {
    startTransition(async () => {
      try {
        await work()
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Action failed."
        )
      }
    })
  }

  if (status === "upcoming") {
    return (
      <Button
        size="lg"
        disabled={pending}
        onClick={() => run(() => startMeeting(meetingId))}
      >
        {pending ? "Starting…" : "Start meeting"}
      </Button>
    )
  }

  if (status === "in_progress") {
    if (!activeRound || activeRound.ended_at) {
      return (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  startRound({ meetingId, roundType: "updates" })
                )
              }
            >
              Start updates round
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  startRound({ meetingId, roundType: "commitments" })
                )
              }
            >
              Start commitments round
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  startRound({ meetingId, roundType: "lightning" })
                )
              }
            >
              Lightning round
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  startRound({ meetingId, roundType: "brainstorm" })
                )
              }
            >
              Brainstorm round
            </Button>
          </div>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => closeMeeting(meetingId))}
            className="w-full"
          >
            Close meeting & wrap
          </Button>
        </div>
      )
    }

    // Round in progress: show "up now" + advance button.
    const order = activeRound.order_member_ids
    const idx = activeRound.current_index
    const upNow = idx < order.length ? memberName[order[idx]] ?? "—" : null
    const done = idx >= order.length

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-card p-6 text-center">
          {done ? (
            <p className="font-heading text-xl">Round complete.</p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Up now
              </p>
              <p className="font-heading text-3xl font-semibold">{upNow}</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {Math.min(idx, order.length)} of {order.length} revealed
          </span>
          <Button
            className="ml-auto"
            disabled={pending || done}
            onClick={() => run(() => advanceRound(activeRound.id))}
          >
            {done ? "Finished" : `✓ Done · Reveal next 🎲`}
          </Button>
        </div>
      </div>
    )
  }

  // closed or cancelled
  return (
    <div className="rounded-lg border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
      Meeting is {status}.
    </div>
  )
}
