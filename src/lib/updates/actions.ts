"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import { ENVELOPE_RE, MAX_ENVELOPE_CHARS } from "@/lib/updates/envelope"

/**
 * Updates are end-to-end encrypted: the device sends an opaque envelope
 * (validated here only for shape) plus the four QoL scores in the clear
 * (the one legitimately shared part), and, at finalize time, any item the
 * member chose to publish. The server never writes plaintext `content`.
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

const envelopeSchema = z.string().max(MAX_ENVELOPE_CHARS).regex(ENVELOPE_RE)
const qolSchema = z.object({
  physical_health: z.number().int().min(1).max(10),
  mental_health: z.number().int().min(1).max(10),
  financial_health: z.number().int().min(1).max(10),
  friends_community: z.number().int().min(1).max(10),
})
export type QolScores = z.infer<typeof qolSchema>

const publishTopicSchema = z.object({
  text: z.string().trim().min(1).max(500),
  context: z.string().max(2000).default(""),
  urgency: z.enum(["low", "med", "high"]),
  tool_category: z.enum(["EQ", "IQ"]),
  exploration_format: z.string().min(1).max(40),
})
const commitmentSchema = z.object({
  text: z.string().trim().min(1).max(500),
  horizon: z.enum(["day", "week", "month"]),
})

const saveSchema = z.object({
  meetingId: z.string().uuid(),
  contentEnc: envelopeSchema,
  qol: qolSchema,
  /** The id of the key the envelope was made with; must be the member's CURRENT key. */
  keyId: z.string().uuid(),
})

function qolColumns(q: QolScores) {
  return {
    qol_physical: q.physical_health,
    qol_mental: q.mental_health,
    qol_financial: q.financial_health,
    qol_friends: q.friends_community,
  }
}

const STALE_KEY = "This device is still using an old key. Lock it (Me → Security) and unlock again."

/**
 * A device that was unlocked before a "Start fresh" elsewhere still holds
 * the retired key. Refuse anything encrypted with a key that isn't the
 * member's current one, so such a device can never store an envelope
 * nobody can open.
 */
async function assertCurrentKey(memberId: string, keyId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.from("member_key_wraps").select("id").eq("member_id", memberId).eq("key_id", keyId).limit(1).maybeSingle()
  return !!data
}

export async function saveUpdateDraft(input: {
  meetingId: string
  contentEnc: string
  qol: QolScores
  keyId: string
}): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "That draft couldn't be saved (bad data)." }
  if (!(await assertCurrentKey(me.id, parsed.data.keyId))) return { ok: false, error: STALE_KEY }

  const supabase = await createClient()
  const { error } = await supabase.from("updates").upsert(
    {
      member_id: me.id,
      meeting_id: parsed.data.meetingId,
      content_enc: parsed.data.contentEnc,
      content: null,
      ...qolColumns(parsed.data.qol),
    },
    { onConflict: "member_id,meeting_id" }
  )
  if (error) return { ok: false, error: "Couldn't save the draft. Check your connection and try again." }
  return { ok: true }
}

export async function finalizeUpdate(input: {
  meetingId: string
  contentEnc: string
  qol: QolScores
  keyId: string
  ready: boolean
  /** Present only when the member chose to publish the topic to the parking lot. */
  publishTopic?: z.infer<typeof publishTopicSchema> | null
  /** Present only when the member chose to make the goal a commitment. */
  commitment?: z.infer<typeof commitmentSchema> | null
}): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = saveSchema
    .extend({
      ready: z.boolean(),
      publishTopic: publishTopicSchema.nullable().optional(),
      commitment: commitmentSchema.nullable().optional(),
    })
    .safeParse(input)
  if (!parsed.success) return { ok: false, error: "That update couldn't be finalized (bad data)." }
  const { meetingId, contentEnc, qol, ready, publishTopic, commitment } = parsed.data
  if (!(await assertCurrentKey(me.id, parsed.data.keyId))) return { ok: false, error: STALE_KEY }

  const supabase = await createClient()
  const { error: upsertError } = await supabase.from("updates").upsert(
    {
      member_id: me.id,
      meeting_id: meetingId,
      content_enc: contentEnc,
      content: null,
      ...qolColumns(qol),
      ready,
      completed_at: new Date().toISOString(),
    },
    { onConflict: "member_id,meeting_id" }
  )
  if (upsertError) return { ok: false, error: "Couldn't finalize the update. Check your connection and try again." }

  // Mirror Ready flag to the attendees table so the moderator's lobby sees it.
  if (ready) {
    const { error: attErr } = await supabase.from("attendees").upsert(
      {
        meeting_id: meetingId,
        member_id: me.id,
        attending: true,
        ready: true,
        ready_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id,member_id" }
    )
    if (attErr) return { ok: false, error: "Saved, but couldn't mark you Ready. Try again." }
  }

  // The topic the member chose to publish (shared by their choice, as before).
  if (publishTopic) {
    const { data: existing } = await supabase
      .from("parking_lot_items")
      .select("id")
      .eq("forum_id", me.forum_id)
      .eq("submitter_member_id", me.id)
      .eq("topic", publishTopic.text)
      .eq("status", "parked")
      .maybeSingle()
    if (!existing) {
      const { error: plErr } = await supabase.from("parking_lot_items").insert({
        forum_id: me.forum_id,
        submitter_member_id: me.id,
        added_by_member_id: me.id,
        topic: publishTopic.text,
        context: publishTopic.context.trim() || null,
        urgency: publishTopic.urgency,
        tool_category: publishTopic.tool_category,
        exploration_format: publishTopic.exploration_format,
      })
      if (plErr) return { ok: false, error: "Saved, but the topic couldn't be parked. Park it from the Parking Lot." }
    }
  }

  // The goal the member chose to make a commitment.
  if (commitment) {
    const { data: existing } = await supabase
      .from("commitments")
      .select("id")
      .eq("forum_id", me.forum_id)
      .eq("member_id", me.id)
      .eq("meeting_id", meetingId)
      .eq("text", commitment.text)
      .maybeSingle()
    if (!existing) {
      const dueOffsetDays = commitment.horizon === "day" ? 1 : commitment.horizon === "week" ? 7 : 30
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + dueOffsetDays)
      const { error: cErr } = await supabase.from("commitments").insert({
        forum_id: me.forum_id,
        member_id: me.id,
        meeting_id: meetingId,
        text: commitment.text,
        due_date: dueDate.toISOString().slice(0, 10),
      })
      if (cErr) return { ok: false, error: "Saved, but the commitment couldn't be created. Add it under Commitments." }
    }
  }

  revalidatePath("/dashboard")
  return { ok: true }
}

/**
 * The member's rows that still hold readable text (never migrated). Read by
 * the device during setup, encrypted there, then written back through
 * migrateUpdates(). This is the only server code path that still returns
 * update plaintext, and only ever the caller's own legacy rows.
 */
export async function getMyLegacyUpdates(): Promise<
  { meetingId: string; content: unknown; completedAt: string | null }[]
> {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data } = await supabase
    .from("updates")
    .select("meeting_id, content, completed_at")
    .eq("member_id", me.id)
    .not("content", "is", null)
    .order("completed_at", { ascending: false })
  return (data ?? []).map((r) => ({ meetingId: r.meeting_id, content: r.content, completedAt: r.completed_at }))
}

export async function migrateUpdates(
  rows: { meetingId: string; contentEnc: string; qol: QolScores; keyId: string }[]
): Promise<ActionResult> {
  const me = await requireCurrentMember()
  const parsed = z.array(saveSchema).max(50).safeParse(rows)
  if (!parsed.success) return { ok: false, error: "Bad migration payload." }
  if (parsed.data.length === 0) return { ok: true }
  if (!(await assertCurrentKey(me.id, parsed.data[0].keyId)) || parsed.data.some((r) => r.keyId !== parsed.data[0].keyId)) {
    return { ok: false, error: STALE_KEY }
  }
  const supabase = await createClient()
  for (const r of parsed.data) {
    // Only rows still in plaintext: never overwrite an already-encrypted row.
    const { error } = await supabase
      .from("updates")
      .update({ content_enc: r.contentEnc, content: null, ...qolColumns(r.qol) })
      .eq("member_id", me.id)
      .eq("meeting_id", r.meetingId)
      .is("content_enc", null)
    if (error) return { ok: false, error: "Couldn't protect one of your past updates. Try again." }
  }
  return { ok: true }
}
