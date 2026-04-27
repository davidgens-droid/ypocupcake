"use server"

import { revalidatePath } from "next/cache"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"

type SaveArgs = {
  meetingId: string
  content: UpdateContent
}

export async function saveUpdateDraft({ meetingId, content }: SaveArgs) {
  const me = await requireCurrentMember()
  const parsed = updateContentSchema.parse(content)

  const supabase = await createClient()
  const { error } = await supabase.from("updates").upsert(
    {
      member_id: me.id,
      meeting_id: meetingId,
      content: parsed,
    },
    { onConflict: "member_id,meeting_id" }
  )

  if (error) throw new Error(error.message)
  return { ok: true as const }
}

type FinalizeArgs = SaveArgs & { ready: boolean }

export async function finalizeUpdate({
  meetingId,
  content,
  ready,
}: FinalizeArgs) {
  const me = await requireCurrentMember()
  const parsed = updateContentSchema.parse(content)

  const supabase = await createClient()

  const { error: upsertError } = await supabase.from("updates").upsert(
    {
      member_id: me.id,
      meeting_id: meetingId,
      content: parsed,
      ready,
      completed_at: new Date().toISOString(),
    },
    { onConflict: "member_id,meeting_id" }
  )
  if (upsertError) throw new Error(upsertError.message)

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
    if (attErr) throw new Error(attErr.message)
  }

  // If the topic step is published, ensure a parking lot item exists.
  if (parsed.topic.publish_to_parking_lot && parsed.topic.text.trim()) {
    const { data: existing } = await supabase
      .from("parking_lot_items")
      .select("id")
      .eq("submitter_member_id", me.id)
      .eq("topic", parsed.topic.text.trim())
      .eq("status", "parked")
      .maybeSingle()

    if (!existing) {
      const { error: plErr } = await supabase.from("parking_lot_items").insert({
        forum_id: me.forum_id,
        submitter_member_id: me.id,
        added_by_member_id: me.id,
        topic: parsed.topic.text.trim(),
        context: parsed.topic.context.trim() || null,
        urgency: parsed.topic.urgency,
        tool_category: parsed.topic.tool_category,
        exploration_format: parsed.topic.exploration_format,
      })
      if (plErr) throw new Error(plErr.message)
    }
  }

  // If the goal is opted-in to be a Commitment, ensure one exists.
  if (parsed.goal.make_commitment && parsed.goal.text.trim()) {
    const { data: existing } = await supabase
      .from("commitments")
      .select("id")
      .eq("member_id", me.id)
      .eq("meeting_id", meetingId)
      .eq("text", parsed.goal.text.trim())
      .maybeSingle()

    if (!existing) {
      const dueOffsetDays =
        parsed.goal.horizon === "day"
          ? 1
          : parsed.goal.horizon === "week"
            ? 7
            : 30
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + dueOffsetDays)

      const { error: cErr } = await supabase.from("commitments").insert({
        forum_id: me.forum_id,
        member_id: me.id,
        meeting_id: meetingId,
        text: parsed.goal.text.trim(),
        due_date: dueDate.toISOString().slice(0, 10),
      })
      if (cErr) throw new Error(cErr.message)
    }
  }

  revalidatePath("/dashboard")
  return { ok: true as const }
}
