"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ClipboardList } from "lucide-react"
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
import { PresentingOrder } from "@/components/app/meeting/presenting-order"
import { ListeningModePanel } from "@/components/app/meeting/listening-mode"
import {
  LISTENING_MAX_CHARS,
  type ListeningExtractResult,
} from "@/lib/parking-lot/listening"
import {
  CaptureTopicButton,
  type FormatOption,
} from "@/components/app/meeting/capture-topic-button"
import {
  QuickJotPanel,
  type FailedJot,
} from "@/components/app/meeting/quick-jot-input"
import {
  advanceExploration,
  advanceRound,
  adjustTimer,
  cancelActiveRound,
  closeMeeting,
  reorderRound,
  resetMeeting,
  revealPresenter,
  shuffleRemaining,
  startExploration,
  startMeeting,
  startRound,
  type OrderResult,
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

/** Round types whose turns are updates worth listening to for parking-lot topics. */
const LISTENING_ROUND_TYPES = new Set(["updates", "experience_sharing"])
const ROUND_LABEL: Record<string, string> = {
  updates: "the updates round",
  experience_sharing: "experience sharing",
  commitments: "the commitments round",
  lightning: "the lightning round",
  brainstorm: "the brainstorm",
  needs_and_leads: "needs & leads",
  exploration: "an exploration",
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
  capturedCount: number
  formats: FormatOption[]
}

export function RunnerControls({
  meetingId,
  status,
  activeRound,
  memberName,
  parkingLotChoices,
  capturedCount,
  formats,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [pickedItemId, setPickedItemId] = useState<string>(
    parkingLotChoices[0]?.id ?? ""
  )
  useMeetingRealtime(meetingId)
  // Quick-jot notes whose save failed. Held here (not in the per-presenter
  // input) so they survive presenter changes and round/phase moves, and can be
  // retried against the presenter they were jotted for.
  const [failedJots, setFailedJots] = useState<FailedJot[]>([])

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

  /**
   * Order edits (drag / arrows / shuffle) run outside the shared transition so
   * the list stays interactive, return the server's verdict so the list can
   * snap back on failure, and ALWAYS refresh — a refusal means the server
   * knows something this screen doesn't.
   */
  async function applyOrder(work: () => Promise<OrderResult>): Promise<boolean> {
    try {
      const res = await work()
      if (!res.ok) toast.error(res.error, { duration: 6000 })
      router.refresh()
      return res.ok
    } catch {
      toast.error("Couldn't save the order. Check your connection and try again.")
      router.refresh()
      return false
    }
  }

  /**
   * Listening mode hands over everything heard during a presenter's turn the
   * moment it ends. A plain fetch to a route handler — NOT a Server Action,
   * which the app router would queue in series and so hold up the next
   * reveal for the whole extraction. `keepalive` lets a flush fired while
   * navigating away complete; the result lands as a toast + a refreshed
   * captured count.
   */
  function flushListening(presenterId: string, transcript: string) {
    const name = memberName[presenterId]?.split(" ")[0] ?? "the presenter"
    const id = toast.loading(
      `Listening mode: looking for parking-lot topics in ${name}'s update…`
    )
    const body = JSON.stringify({
      meetingId,
      presenterMemberId: presenterId,
      transcript: transcript.slice(0, LISTENING_MAX_CHARS),
    })
    fetch("/api/listening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // keepalive bodies are capped at 64KB by browsers.
      keepalive: body.length < 60_000,
    })
      .then(async (httpRes) => {
        const res = (await httpRes.json().catch(() => null)) as ListeningExtractResult | null
        if (!httpRes.ok || !res) {
          toast.error(
            res && !res.ok ? res.error : "Listening mode: couldn't extract topics. Nothing was saved.",
            { id, duration: 8000 }
          )
          return
        }
        if (!res.ok) {
          toast.error(res.error, { id, duration: 8000 })
          return
        }
        if (res.topics.length === 0) {
          toast.success(`Listening mode: no parking-lot topics spotted in ${name}'s update.`, { id })
          return
        }
        toast.success(
          `Listening mode: ${res.topics.length} potential topic${res.topics.length === 1 ? "" : "s"} captured for ${name} — review after the meeting.`,
          { id, duration: 8000 }
        )
        router.refresh()
      })
      .catch(() => {
        toast.error("Listening mode: couldn't extract topics. Nothing was saved.", { id })
      })
  }

  const reviewButton =
    capturedCount > 0 ? (
      <Button
        variant="outline"
        className="w-full gap-2"
        render={<Link href={`/meeting/${meetingId}/parking-lot-review`} />}
      >
        <ClipboardList className="size-4" /> Review captured topics (
        {capturedCount})
      </Button>
    ) : null

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

          {reviewButton}

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
      const presenting = activeRound.current_started_at != null
      const upNow = phase.has_round && presenting && idx < order.length
        ? memberName[order[idx]]
        : null
      const isLastPhase = phaseIdx >= phases.length - 1
      // In a has-round phase, who hasn't presented yet.
      const selectingPool = phase.has_round ? order.slice(idx) : []
      const remainingAfterCurrent = phase.has_round ? order.slice(idx + 1) : []

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
                beep={phase.has_round}
              />
            </div>

            {phase.has_round && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {Math.min(idx, order.length)} of {order.length} revealed
              </p>
            )}
          </div>

          {/* Explorations already revolve around a parked topic; members'
              turns there are responses, not updates — listening is paused,
              but the switch stays visible so "is it still on?" has an answer. */}
          <ListeningModePanel
            meetingId={meetingId}
            presenterId={null}
            presenterName={null}
            pausedLabel={ROUND_LABEL.exploration}
            onFlush={flushListening}
          />

          {/* Has-round phase, nobody up yet → moderator chooses who shares first */}
          {phase.has_round && !presenting && selectingPool.length > 0 && (
            <PresenterPicker
              label="Who shares first?"
              pool={selectingPool}
              memberName={memberName}
              pending={pending}
              cta={(name) => (name ? `Reveal ${name}` : "🎲 Reveal random")}
              onReveal={(memberId) =>
                run(() => revealPresenter({ roundId: activeRound.id, memberId }))
              }
            />
          )}

          {/* Has-round phase with no eligible members → let the moderator move on */}
          {phase.has_round && !presenting && selectingPool.length === 0 && (
            <Button
              className="w-full"
              disabled={pending}
              onClick={() =>
                run(() => advanceExploration({ roundId: activeRound.id }))
              }
            >
              {isLastPhase
                ? "End exploration"
                : `Next phase: ${phases[phaseIdx + 1]?.name}`}
            </Button>
          )}

          {/* Has-round phase, someone presenting → done + reveal next */}
          {phase.has_round && presenting && (
            <div className="space-y-2">
              {upNow && order[idx] && (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                  {/* Zero-click capture: type, Enter, parked for the presenter. */}
                  <QuickJotPanel
                    meetingId={meetingId}
                    presenterMemberId={order[idx]}
                    presenterName={upNow}
                    failed={failedJots}
                    setFailed={setFailedJots}
                  />
                  {/* Full form (context + exploration type) still available. */}
                  <CaptureTopicButton
                    meetingId={meetingId}
                    presenterMemberId={order[idx]}
                    presenterName={upNow}
                    formats={formats}
                  />
                </div>
              )}
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
              </div>
              {remainingAfterCurrent.length > 0 ? (
                <PresenterPicker
                  key={`xnext-${phaseIdx}-${idx}`}
                  label="Who's next?"
                  pool={remainingAfterCurrent}
                  memberName={memberName}
                  pending={pending}
                  cta={(name) =>
                    name ? `✓ Done · reveal ${name}` : "✓ Done · reveal random"
                  }
                  onReveal={(nextMemberId) =>
                    run(() =>
                      advanceExploration({ roundId: activeRound.id, nextMemberId })
                    )
                  }
                />
              ) : (
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    run(() => advanceExploration({ roundId: activeRound.id }))
                  }
                >
                  {isLastPhase
                    ? "✓ Done · End exploration"
                    : `✓ Done · Next phase: ${phases[phaseIdx + 1]?.name}`}
                </Button>
              )}
            </div>
          )}

          {/* Non-round phase → just advance to the next phase / end */}
          {!phase.has_round && (
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
                onClick={() =>
                  run(() => advanceExploration({ roundId: activeRound.id }))
                }
              >
                {isLastPhase
                  ? "End exploration"
                  : `Next phase: ${phases[phaseIdx + 1]?.name}`}
              </Button>
            </div>
          )}

          {phase.has_round && (
            <PresentingOrder
              order={order}
              currentIndex={idx}
              presenting={presenting}
              memberName={memberName}
              pending={pending}
              onReorder={(tail) =>
                applyOrder(() =>
                  reorderRound({ roundId: activeRound.id, orderMemberIds: tail })
                )
              }
              onShuffle={() =>
                void applyOrder(() => shuffleRemaining({ roundId: activeRound.id }))
              }
            />
          )}

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
    const presenting = activeRound.current_started_at != null
    const done = idx >= order.length
    const upNow = presenting && idx < order.length ? memberName[order[idx]] ?? "—" : null
    const selectingPool = order.slice(idx) // not yet presented
    const remainingAfterCurrent = order.slice(idx + 1)

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-card p-6 text-center">
          {done ? (
            <p className="font-heading text-xl">Round complete.</p>
          ) : presenting ? (
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
                beep
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {selectingPool[0] ? (
                <>
                  Up {idx === 0 ? "first" : "next"}:{" "}
                  <span className="font-medium text-foreground">
                    {memberName[selectingPool[0]] ?? "Unknown"}
                  </span>
                  . Reveal them, pick someone else, or drag the list below to
                  change the order.
                </>
              ) : (
                "Nobody left to reveal."
              )}
            </p>
          )}
        </div>

        {/* Only where someone is giving an update — not 60-second commitment
            or lightning turns, which aren't parking-lot material. */}
        {!done &&
          (LISTENING_ROUND_TYPES.has(activeRound.round_type) ? (
            <ListeningModePanel
              meetingId={meetingId}
              presenterId={presenting && idx < order.length ? order[idx] : null}
              presenterName={upNow}
              onFlush={flushListening}
            />
          ) : (
            <ListeningModePanel
              meetingId={meetingId}
              presenterId={null}
              presenterName={null}
              pausedLabel={ROUND_LABEL[activeRound.round_type] ?? "this round"}
              onFlush={flushListening}
            />
          ))}

        {/* Selecting state — nobody up yet */}
        {!done && !presenting && (
          <PresenterPicker
            label={idx === 0 ? "Who presents first?" : "Who's next?"}
            pool={selectingPool}
            memberName={memberName}
            pending={pending}
            cta={(name) => (name ? `Reveal ${name}` : "🎲 Reveal random")}
            onReveal={(memberId) =>
              run(() => revealPresenter({ roundId: activeRound.id, memberId }))
            }
          />
        )}

        {/* Presenting state — timer controls + done/reveal-next */}
        {!done && presenting && (
          <div className="space-y-3">
            {upNow && order[idx] && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                {/* Zero-click capture: type, Enter, parked for the presenter. */}
                <QuickJotPanel
                  meetingId={meetingId}
                  presenterMemberId={order[idx]}
                  presenterName={upNow}
                  failed={failedJots}
                  setFailed={setFailedJots}
                />
                {/* Full form (context + exploration type) still available. */}
                <CaptureTopicButton
                  meetingId={meetingId}
                  presenterMemberId={order[idx]}
                  presenterName={upNow}
                  formats={formats}
                />
              </div>
            )}
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
              <span className="ml-auto text-xs text-muted-foreground">
                {Math.min(idx, order.length)} of {order.length} done
              </span>
            </div>

            {remainingAfterCurrent.length > 0 ? (
              <PresenterPicker
                key={`next-${idx}`}
                label="Who's next?"
                pool={remainingAfterCurrent}
                memberName={memberName}
                pending={pending}
                cta={(name) =>
                  name ? `✓ Done · reveal ${name}` : "✓ Done · reveal random"
                }
                onReveal={(nextMemberId) =>
                  run(() => advanceRound({ roundId: activeRound.id, nextMemberId }))
                }
              />
            ) : (
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => run(() => advanceRound({ roundId: activeRound.id }))}
              >
                ✓ Done · End round
              </Button>
            )}
          </div>
        )}

        <PresentingOrder
          order={order}
          currentIndex={idx}
          presenting={presenting}
          memberName={memberName}
          pending={pending}
          onReorder={(tail) =>
            applyOrder(() =>
              reorderRound({ roundId: activeRound.id, orderMemberIds: tail })
            )
          }
          onShuffle={() =>
            void applyOrder(() => shuffleRemaining({ roundId: activeRound.id }))
          }
        />

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
          description="Ends the current round immediately. You'll return to the meeting lobby and can start a fresh round."
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
      {reviewButton}
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

const RANDOM = "__random__"

/**
 * "Who's next?" — defaults to the next name in the presenting order (which the
 * moderator can rearrange in the list below), with the option to jump to a
 * specific person or let the server pick someone at random.
 */
function PresenterPicker({
  label,
  pool,
  memberName,
  pending,
  cta,
  onReveal,
}: {
  label: string
  /** Not-yet-revealed members, in presenting order. */
  pool: string[]
  memberName: Record<string, string>
  pending: boolean
  cta: (selectedName: string | null) => string
  onReveal: (memberId: string | null) => void
}) {
  // "" = next in order; RANDOM = let the server pick; otherwise a member id.
  const [selected, setSelected] = useState<string>("")

  const nextId = pool[0] ?? null
  const nextName = nextId ? memberName[nextId] ?? "Unknown" : null
  const others = pool
    .filter((id) => id !== nextId)
    .map((id) => ({ id, name: memberName[id] ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Never null for an explicit pick — a member missing from the name map must
  // still read "Reveal Unknown", not "Reveal random".
  const selectedName =
    selected === RANDOM
      ? null
      : selected
        ? memberName[selected] ?? "Unknown"
        : nextName

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm font-medium">{label}</p>
      <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
        <SelectTrigger className="w-full">
          <span data-slot="select-value">
            {selected === RANDOM
              ? "🎲 Random"
              : selected
                ? selectedName
                : `Next in order · ${nextName ?? "—"}`}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Next in order · {nextName ?? "—"}</SelectItem>
          <SelectItem value={RANDOM}>🎲 Random</SelectItem>
          {others.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="w-full"
        disabled={pending || pool.length === 0}
        onClick={() =>
          onReveal(selected === RANDOM ? null : selected || nextId)
        }
      >
        {cta(selectedName)}
      </Button>
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
