"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { RoundTimer } from "@/components/app/meeting/round-timer"
import {
  advanceExploration,
  advanceRound,
  adjustTimer,
  cancelActiveRound,
  closeMeeting,
  resetMeeting,
  startExploration,
  startMeeting,
  startRound,
} from "@/lib/meetings/actions"
import {
  getCurrentPhase,
  getPhases,
} from "@/lib/meetings/exploration-phases"
import { useMeetingRealtime } from "@/lib/meetings/use-meeting-realtime"
import type { ExplorationFormatCode } from "@/lib/types/domain"

type ParkingLotChoice = {
  id: string
  topic: string
  exploration_format: ExplorationFormatCode
  format_label: string
}

type Props = {
  meetingId: string
  status: string
  activeRound: {
    id: string
    round_type: string
    order_member_ids: string[]
    current_index: number
    ended_at: string | null
    current_started_at: string | null
    per_member_seconds: number
    exploration_format: ExplorationFormatCode | null
    phase_index: number | null
    phase_started_at: string | null
    parking_lot_item_id: string | null
  } | null
  memberName: Record<string, string>
  parkingLotChoices: ParkingLotChoice[]
}

export function RunnerControls({
  meetingId,
  status,
  activeRound,
  memberName,
  parkingLotChoices,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pickedItemId, setPickedItemId] = useState<string>(
    parkingLotChoices[0]?.id ?? ""
  )
  useMeetingRealtime(meetingId)

  function run<T>(work: () => Promise<T>) {
    startTransition(async () => {
      try {
        await work()
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed.")
      }
    })
  }

  // ── 1. Lobby ──────────────────────────────────────────────────────────────
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

  // ── 2. In progress ────────────────────────────────────────────────────────
  if (status === "in_progress") {
    // No active round — show "what to run next" picker.
    if (!activeRound || activeRound.ended_at) {
      const pickedItem = parkingLotChoices.find((p) => p.id === pickedItemId)

      return (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => startRound({ meetingId, roundType: "updates" }))
              }
            >
              Start updates round
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => startRound({ meetingId, roundType: "commitments" }))
              }
            >
              Commitments round
            </Button>
          </div>

          {parkingLotChoices.length > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <p className="text-sm font-medium">Run an Exploration</p>
              <p className="text-xs text-muted-foreground">
                Pick a parking-lot item to explore using its assigned format.
              </p>
              <Select
                value={pickedItemId}
                onValueChange={(v) => setPickedItemId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <span data-slot="select-value">
                    {pickedItem
                      ? `${pickedItem.topic} · ${pickedItem.format_label}`
                      : "Pick a topic"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {parkingLotChoices.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.topic} · {p.format_label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={pending || !pickedItemId}
                onClick={() =>
                  run(() =>
                    startExploration({
                      meetingId,
                      parkingLotItemId: pickedItemId,
                    })
                  )
                }
              >
                Start exploration
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => closeMeeting(meetingId))}
            className="w-full"
          >
            Close meeting & wrap
          </Button>

          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:bg-destructive/10"
              >
                Reset meeting (start over)
              </Button>
            }
            title="Reset this meeting?"
            description="Deletes all rounds and returns the meeting to its 'upcoming' state so you can re-start from the lobby. Parking-lot items scheduled into this meeting go back to 'parked'."
            confirmLabel="Yes, reset"
            disabled={pending}
            onConfirm={() => run(() => resetMeeting(meetingId))}
          />
        </div>
      )
    }

    // Exploration round in progress
    if (activeRound.round_type === "exploration") {
      const phases = getPhases(activeRound.exploration_format)
      const phaseIdx = activeRound.phase_index ?? 0
      const phase = getCurrentPhase(activeRound.exploration_format, phaseIdx)
      if (!phase) return null

      const order = activeRound.order_member_ids
      const idx = activeRound.current_index ?? 0
      const upNow = phase.has_round && idx < order.length ? memberName[order[idx]] : null
      const roundDone = phase.has_round && idx >= order.length
      const isLastPhase = phaseIdx >= phases.length - 1

      return (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
              <span>
                Phase {phaseIdx + 1} of {phases.length}
              </span>
              <span>{phase.name}</span>
            </div>
            <p className="mt-2 text-sm">{phase.description}</p>
            {phase.moderator_note && (
              <p className="mt-1 text-xs text-muted-foreground italic">
                {phase.moderator_note}
              </p>
            )}

            {phase.has_round && upNow && (
              <div className="mt-4 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Up now
                </p>
                <p className="font-heading text-3xl font-semibold">{upNow}</p>
              </div>
            )}

            <div className="mt-4">
              <RoundTimer
                startedAt={
                  phase.has_round
                    ? activeRound.current_started_at
                    : activeRound.phase_started_at
                }
                perMemberSeconds={activeRound.per_member_seconds}
                size="lg"
              />
            </div>

            {phase.has_round && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {Math.min(idx, order.length)} of {order.length} revealed
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => adjustTimer(activeRound.id, -30))}
            >
              −30s
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => adjustTimer(activeRound.id, 30))}
            >
              +30s
            </Button>
            <Button
              className="ml-auto"
              disabled={pending}
              onClick={() => run(() => advanceExploration(activeRound.id))}
            >
              {phase.has_round && !roundDone
                ? "✓ Done · Reveal next 🎲"
                : isLastPhase
                  ? "End exploration"
                  : `Next phase: ${phases[phaseIdx + 1]?.name}`}
            </Button>
          </div>

          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
              >
                Cancel this exploration
              </Button>
            }
            title="Cancel this exploration?"
            description="Ends the current exploration and returns you to the meeting lobby. The parking-lot item goes back to 'parked' so you can start fresh."
            confirmLabel="Yes, cancel"
            disabled={pending}
            onConfirm={() => run(() => cancelActiveRound(meetingId))}
          />
        </div>
      )
    }

    // Plain round (updates / commitments / lightning / brainstorm) in progress
    const order = activeRound.order_member_ids
    const idx = activeRound.current_index ?? 0
    const upNow = idx < order.length ? memberName[order[idx]] ?? "—" : null
    const done = idx >= order.length

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-card p-6 text-center">
          {done ? (
            <p className="font-heading text-xl">Round complete.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Up now
                </p>
                <p className="font-heading text-3xl font-semibold">{upNow}</p>
              </div>
              <RoundTimer
                startedAt={activeRound.current_started_at}
                perMemberSeconds={activeRound.per_member_seconds}
                size="lg"
              />
            </div>
          )}
        </div>

        {!done && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => adjustTimer(activeRound.id, -30))}
            >
              −30s
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => adjustTimer(activeRound.id, 30))}
            >
              +30s
            </Button>
            <span className="ml-2 text-xs text-muted-foreground">
              per-member: {activeRound.per_member_seconds}s
            </span>
          </div>
        )}

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

        <ConfirmDialog
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              Cancel this round
            </Button>
          }
          title="Cancel this round?"
          description="Ends the current round immediately. You'll return to the meeting lobby and can start a fresh round — the random order will be regenerated."
          confirmLabel="Yes, cancel round"
          disabled={pending}
          onConfirm={() => run(() => cancelActiveRound(meetingId))}
        />
      </div>
    )
  }

  // ── 3. Closed/cancelled ───────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        Meeting is {status}.
      </div>
      <ConfirmDialog
        trigger={
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10"
          >
            Reset meeting (re-open)
          </Button>
        }
        title="Re-open this meeting?"
        description="Returns the meeting to its 'upcoming' state so you can start it again. All previous rounds will be discarded."
        confirmLabel="Yes, reset"
        disabled={pending}
        onConfirm={() => run(() => resetMeeting(meetingId))}
      />
    </div>
  )
}

function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  trigger: React.ReactNode
  title: string
  description: string
  confirmLabel: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
