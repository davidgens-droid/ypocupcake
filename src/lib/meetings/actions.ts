"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  getCurrentPhase,
  getPhases,
} from "@/lib/meetings/exploration-phases"
import type { ExplorationFormatCode } from "@/lib/types/domain"

async function ensureMod() {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data: roles } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const isModerator = (roles ?? []).some((r) =>
    ["moderator", "assistant_moderator"].includes(r.role_type)
  )
  if (!isModerator && !me.is_admin) {
    throw new Error("Moderator-only action.")
  }
  return { me, supabase }
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export async function startMeeting(meetingId: string) {
  const { supabase } = await ensureMod()
  const { error } = await supabase
    .from("meetings")
    .update({ status: "in_progress" })
    .eq("id", meetingId)
  if (error) throw new Error(error.message)
  revalidatePath(`/meeting/${meetingId}`)
  revalidatePath(`/meeting/${meetingId}/run`)
}

const startRoundSchema = z.object({
  meetingId: z.string().uuid(),
  roundType: z.enum([
    "updates",
    "experience_sharing",
    "commitments",
    "lightning",
    "brainstorm",
    "needs_and_leads",
  ]),
})

export async function startRound(input: z.infer<typeof startRoundSchema>) {
  const { supabase } = await ensureMod()
  const parsed = startRoundSchema.parse(input)

  // Pull attending members for this meeting; default to all members if no
  // attendance rows yet.
  const { data: attendees } = await supabase
    .from("attendees")
    .select("member_id, attending")
    .eq("meeting_id", parsed.meetingId)

  let memberIds = (attendees ?? [])
    .filter((a) => a.attending)
    .map((a) => a.member_id)

  if (memberIds.length === 0) {
    const { data: all } = await supabase.from("members").select("id")
    memberIds = (all ?? []).map((m) => m.id)
  }

  const order = shuffle(memberIds)
  const now = new Date().toISOString()

  const perMemberSeconds =
    parsed.roundType === "lightning"
      ? 60
      : parsed.roundType === "commitments"
        ? 60
        : 300 // 5 min default for updates / experience-sharing

  const { data, error } = await supabase
    .from("meeting_rounds")
    .insert({
      meeting_id: parsed.meetingId,
      round_type: parsed.roundType,
      order_member_ids: order,
      current_index: 0,
      started_at: now,
      current_started_at: order.length > 0 ? now : null,
      per_member_seconds: perMemberSeconds,
    })
    .select("id")
    .single()
  if (error) throw new Error(error.message)

  revalidatePath(`/meeting/${parsed.meetingId}`)
  revalidatePath(`/meeting/${parsed.meetingId}/run`)
  return { roundId: data.id as string }
}

export async function advanceRound(roundId: string) {
  const { supabase } = await ensureMod()

  const { data: round, error: fetchErr } = await supabase
    .from("meeting_rounds")
    .select("id, meeting_id, current_index, order_member_ids, ended_at")
    .eq("id", roundId)
    .single()
  if (fetchErr) throw new Error(fetchErr.message)

  const nextIndex = (round.current_index ?? 0) + 1
  const finished = nextIndex >= (round.order_member_ids?.length ?? 0)
  const now = new Date().toISOString()

  const { error } = await supabase
    .from("meeting_rounds")
    .update({
      current_index: nextIndex,
      current_started_at: finished ? null : now,
      ended_at: finished ? now : null,
    })
    .eq("id", roundId)
  if (error) throw new Error(error.message)

  revalidatePath(`/meeting/${round.meeting_id}`)
  revalidatePath(`/meeting/${round.meeting_id}/run`)
}

export async function adjustTimer(roundId: string, deltaSeconds: number) {
  const { supabase } = await ensureMod()
  const { data: round } = await supabase
    .from("meeting_rounds")
    .select("meeting_id, per_member_seconds")
    .eq("id", roundId)
    .single()
  if (!round) return
  const next = Math.max(15, (round.per_member_seconds ?? 300) + deltaSeconds)
  const { error } = await supabase
    .from("meeting_rounds")
    .update({ per_member_seconds: next })
    .eq("id", roundId)
  if (error) throw new Error(error.message)
  revalidatePath(`/meeting/${round.meeting_id}/run`)
}

/**
 * Cancel whatever round is active right now — ends the round so the runner
 * returns to the "what to run next" screen. For exploration rounds, also
 * resets the linked parking-lot item back to "parked" so it can be re-run.
 */
export async function cancelActiveRound(meetingId: string) {
  const { supabase } = await ensureMod()
  const { data: active } = await supabase
    .from("meeting_rounds")
    .select("id, round_type, parking_lot_item_id")
    .eq("meeting_id", meetingId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!active) return

  const now = new Date().toISOString()
  await supabase
    .from("meeting_rounds")
    .update({ ended_at: now, current_started_at: null })
    .eq("id", active.id)

  if (active.round_type === "exploration" && active.parking_lot_item_id) {
    await supabase
      .from("parking_lot_items")
      .update({ status: "parked", scheduled_meeting_id: null })
      .eq("id", active.parking_lot_item_id)
  }

  revalidatePath(`/meeting/${meetingId}/run`)
  revalidatePath(`/meeting/${meetingId}`)
}

/**
 * Nuclear reset — wipes all rounds for this meeting and returns it to the
 * "upcoming" state, so the moderator can re-Start it from scratch. Also frees
 * any parking-lot items that were scheduled into this meeting.
 */
export async function resetMeeting(meetingId: string) {
  const { supabase } = await ensureMod()

  await supabase
    .from("parking_lot_items")
    .update({ status: "parked", scheduled_meeting_id: null })
    .eq("scheduled_meeting_id", meetingId)
    .eq("status", "scheduled")

  await supabase.from("meeting_rounds").delete().eq("meeting_id", meetingId)

  await supabase
    .from("meetings")
    .update({ status: "upcoming", closed_at: null })
    .eq("id", meetingId)

  revalidatePath(`/meeting/${meetingId}/run`)
  revalidatePath(`/meeting/${meetingId}`)
  revalidatePath("/dashboard")
}

export async function endRound(roundId: string) {
  const { supabase } = await ensureMod()
  const { data: round } = await supabase
    .from("meeting_rounds")
    .select("meeting_id")
    .eq("id", roundId)
    .single()
  await supabase
    .from("meeting_rounds")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", roundId)
  if (round) {
    revalidatePath(`/meeting/${round.meeting_id}`)
    revalidatePath(`/meeting/${round.meeting_id}/run`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Format-aware Exploration
// ──────────────────────────────────────────────────────────────────────────
export async function startExploration(input: {
  meetingId: string
  parkingLotItemId: string
}) {
  const { supabase } = await ensureMod()

  const { data: item, error: itemErr } = await supabase
    .from("parking_lot_items")
    .select("id, submitter_member_id, exploration_format, topic")
    .eq("id", input.parkingLotItemId)
    .single()
  if (itemErr || !item) throw new Error("Parking lot item not found.")

  const format = item.exploration_format as ExplorationFormatCode
  const phases = getPhases(format)
  if (phases.length === 0) {
    throw new Error(`Unknown exploration format: ${format}`)
  }

  // Pull attending members
  const { data: attendees } = await supabase
    .from("attendees")
    .select("member_id, attending")
    .eq("meeting_id", input.meetingId)
  let memberIds = (attendees ?? [])
    .filter((a) => a.attending)
    .map((a) => a.member_id)
  if (memberIds.length === 0) {
    const { data: all } = await supabase.from("members").select("id")
    memberIds = (all ?? []).map((m) => m.id)
  }

  const phase0 = phases[0]
  const phase0Order = computeRoundOrder(
    memberIds,
    item.submitter_member_id,
    phase0.has_round,
    phase0.excludes_presenter ?? false
  )
  const now = new Date().toISOString()

  // Mark the parking lot item as scheduled (it's running now).
  await supabase
    .from("parking_lot_items")
    .update({ status: "scheduled", scheduled_meeting_id: input.meetingId })
    .eq("id", input.parkingLotItemId)

  const { data: round, error } = await supabase
    .from("meeting_rounds")
    .insert({
      meeting_id: input.meetingId,
      round_type: "exploration",
      exploration_format: format,
      parking_lot_item_id: item.id,
      phase_index: 0,
      phase_started_at: now,
      order_member_ids: phase0Order,
      current_index: 0,
      current_started_at: phase0.has_round ? now : null,
      per_member_seconds: phase0.default_seconds,
      started_at: now,
    })
    .select("id")
    .single()
  if (error) throw new Error(error.message)

  revalidatePath(`/meeting/${input.meetingId}/run`)
  revalidatePath(`/meeting/${input.meetingId}`)
  return { roundId: round.id as string }
}

export async function advanceExploration(roundId: string) {
  const { supabase } = await ensureMod()

  const { data: round, error: fetchErr } = await supabase
    .from("meeting_rounds")
    .select(
      "id, meeting_id, exploration_format, parking_lot_item_id, phase_index, current_index, order_member_ids"
    )
    .eq("id", roundId)
    .single()
  if (fetchErr || !round) throw new Error("Round not found.")

  const format = round.exploration_format as ExplorationFormatCode | null
  const currentPhase = getCurrentPhase(format, round.phase_index ?? 0)
  if (!currentPhase) {
    // No phase data; just end the round.
    return endRoundFinal(round.meeting_id, roundId, round.parking_lot_item_id)
  }

  const now = new Date().toISOString()

  // If the current phase has a round and there are more members to reveal,
  // just advance current_index.
  if (currentPhase.has_round) {
    const total = round.order_member_ids?.length ?? 0
    const next = (round.current_index ?? 0) + 1
    if (next < total) {
      const { error } = await supabase
        .from("meeting_rounds")
        .update({ current_index: next, current_started_at: now })
        .eq("id", roundId)
      if (error) throw new Error(error.message)
      revalidatePath(`/meeting/${round.meeting_id}/run`)
      revalidatePath(`/meeting/${round.meeting_id}`)
      return
    }
  }

  // Otherwise, advance to the next phase (or end the round).
  const nextPhaseIndex = (round.phase_index ?? 0) + 1
  const phases = getPhases(format)
  if (nextPhaseIndex >= phases.length) {
    return endRoundFinal(round.meeting_id, roundId, round.parking_lot_item_id)
  }

  const nextPhase = phases[nextPhaseIndex]
  // Build the next phase's order if it has a round.
  let nextOrder: string[] = []
  let nextCurrentStartedAt: string | null = null
  if (nextPhase.has_round) {
    const { data: item } = await supabase
      .from("parking_lot_items")
      .select("submitter_member_id")
      .eq("id", round.parking_lot_item_id ?? "")
      .maybeSingle()
    const { data: attendees } = await supabase
      .from("attendees")
      .select("member_id, attending")
      .eq("meeting_id", round.meeting_id)
    let memberIds = (attendees ?? [])
      .filter((a) => a.attending)
      .map((a) => a.member_id)
    if (memberIds.length === 0) {
      const { data: all } = await supabase.from("members").select("id")
      memberIds = (all ?? []).map((m) => m.id)
    }
    nextOrder = computeRoundOrder(
      memberIds,
      item?.submitter_member_id ?? null,
      true,
      nextPhase.excludes_presenter ?? false
    )
    nextCurrentStartedAt = now
  }

  const { error: updErr } = await supabase
    .from("meeting_rounds")
    .update({
      phase_index: nextPhaseIndex,
      phase_started_at: now,
      order_member_ids: nextOrder,
      current_index: 0,
      current_started_at: nextCurrentStartedAt,
      per_member_seconds: nextPhase.default_seconds,
    })
    .eq("id", roundId)
  if (updErr) throw new Error(updErr.message)
  revalidatePath(`/meeting/${round.meeting_id}/run`)
  revalidatePath(`/meeting/${round.meeting_id}`)
}

async function endRoundFinal(
  meetingId: string,
  roundId: string,
  parkingLotItemId: string | null
) {
  const supabase = await createClient()
  const now = new Date().toISOString()
  await supabase
    .from("meeting_rounds")
    .update({ ended_at: now, current_started_at: null })
    .eq("id", roundId)
  if (parkingLotItemId) {
    await supabase
      .from("parking_lot_items")
      .update({ status: "presented", presented_at: now })
      .eq("id", parkingLotItemId)
  }
  revalidatePath(`/meeting/${meetingId}/run`)
  revalidatePath(`/meeting/${meetingId}`)
}

function computeRoundOrder(
  memberIds: string[],
  presenterId: string | null,
  hasRound: boolean,
  excludesPresenter: boolean
): string[] {
  if (!hasRound) return []
  const pool =
    excludesPresenter && presenterId
      ? memberIds.filter((id) => id !== presenterId)
      : memberIds
  return shuffle(pool)
}

export async function closeMeeting(meetingId: string) {
  const { supabase } = await ensureMod()
  const { error } = await supabase
    .from("meetings")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", meetingId)
  if (error) throw new Error(error.message)
  revalidatePath(`/meeting/${meetingId}`)
  revalidatePath(`/meeting/${meetingId}/run`)
  revalidatePath("/dashboard")
}
