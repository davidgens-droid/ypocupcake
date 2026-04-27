"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

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
