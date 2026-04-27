"use client"

import { Card, CardContent } from "@/components/ui/card"
import { RoundTimer } from "@/components/app/meeting/round-timer"
import {
  getCurrentPhase,
  getPhases,
} from "@/lib/meetings/exploration-phases"
import { useMeetingRealtime } from "@/lib/meetings/use-meeting-realtime"
import type { ExplorationFormatCode } from "@/lib/types/domain"

const ROUND_LABEL: Record<string, string> = {
  updates: "Updates round",
  experience_sharing: "Experience sharing",
  commitments: "Commitments",
  lightning: "Lightning round",
  brainstorm: "Brainstorm",
  needs_and_leads: "Needs & Leads",
  exploration: "Exploration",
}

type ActiveRound = {
  id: string
  round_type: string
  order_member_ids: string[]
  current_index: number
  current_started_at: string | null
  per_member_seconds: number
  ended_at: string | null
  exploration_format: ExplorationFormatCode | null
  phase_index: number | null
  phase_started_at: string | null
  parking_lot_item_id: string | null
}

type Props = {
  meetingId: string
  status: string
  activeRound: ActiveRound | null
  myMemberId: string
}

export function MemberMeetingView({
  meetingId,
  status,
  activeRound,
  myMemberId,
}: Props) {
  useMeetingRealtime(meetingId)

  if (status === "upcoming") {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Meeting hasn&apos;t started. The moderator will kick it off.
        </CardContent>
      </Card>
    )
  }

  if (status === "in_progress" && !activeRound) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Meeting in progress. Waiting for the moderator to start the next
          round.
        </CardContent>
      </Card>
    )
  }

  if (status === "in_progress" && activeRound) {
    const isExploration = activeRound.round_type === "exploration"
    const phases = isExploration ? getPhases(activeRound.exploration_format) : []
    const phase = isExploration
      ? getCurrentPhase(activeRound.exploration_format, activeRound.phase_index ?? 0)
      : null

    const myIndex = activeRound.order_member_ids.indexOf(myMemberId)
    const isUpNow =
      (phase?.has_round ?? activeRound.round_type !== "exploration") &&
      myIndex >= 0 &&
      myIndex === activeRound.current_index

    const label = isExploration
      ? phase?.name ?? "Exploration"
      : ROUND_LABEL[activeRound.round_type] ?? activeRound.round_type

    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
            {isExploration && phases.length > 0 && (
              <> · phase {(activeRound.phase_index ?? 0) + 1} of {phases.length}</>
            )}
          </p>
          {phase?.description && (
            <p className="text-xs text-muted-foreground italic">
              {phase.description}
            </p>
          )}
          <p className="font-heading text-2xl font-semibold">
            {isUpNow ? "You're up." : "Listening"}
          </p>
          <div className="flex justify-center pt-2">
            <RoundTimer
              startedAt={
                phase?.has_round || !isExploration
                  ? activeRound.current_started_at
                  : activeRound.phase_started_at
              }
              perMemberSeconds={activeRound.per_member_seconds}
              size="lg"
            />
          </div>
          {(phase?.has_round || !isExploration) && (
            <p className="text-sm text-muted-foreground">
              {Math.min(activeRound.current_index, activeRound.order_member_ids.length)} of{" "}
              {activeRound.order_member_ids.length} revealed.
            </p>
          )}
          {(phase?.has_round || !isExploration) && (
            <p className="text-xs text-muted-foreground">
              Order is randomized and hidden — your turn may come at any time.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (status === "closed") {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Meeting closed.
        </CardContent>
      </Card>
    )
  }

  return null
}
