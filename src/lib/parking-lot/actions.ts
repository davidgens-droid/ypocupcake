"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { notifyMember } from "@/lib/notifications/actions"
import { createClient } from "@/lib/supabase/server"

const newItemSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  context: z.string().trim().max(2000).optional().default(""),
  urgency: z.enum(["low", "med", "high"]),
  tool_category: z.enum(["EQ", "IQ"]),
  exploration_format: z.string().min(1),
  submitter_member_id: z.string().uuid().optional(),
})

export async function createParkingLotItem(formData: FormData) {
  const me = await requireCurrentMember()

  const parsed = newItemSchema.parse({
    topic: formData.get("topic"),
    context: formData.get("context") ?? "",
    urgency: formData.get("urgency"),
    tool_category: formData.get("tool_category"),
    exploration_format: formData.get("exploration_format"),
    submitter_member_id: formData.get("submitter_member_id") || undefined,
  })

  const supabase = await createClient()

  // If a submitter is specified and differs from auth.uid(), the caller must
  // be the czar — the RLS policy parking_lot_czar_insert will enforce this.
  const submitterId = parsed.submitter_member_id ?? me.id

  const { data, error } = await supabase
    .from("parking_lot_items")
    .insert({
      forum_id: me.forum_id,
      submitter_member_id: submitterId,
      added_by_member_id: me.id,
      topic: parsed.topic,
      context: parsed.context.trim() || null,
      urgency: parsed.urgency,
      tool_category: parsed.tool_category,
      exploration_format: parsed.exploration_format,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)

  // Notify the submitter when someone else (czar / moderator / admin) adds
  // on their behalf.
  if (submitterId !== me.id) {
    await notifyMember({
      memberId: submitterId,
      kind: "topic_added_on_behalf",
      title: `${me.name} parked a topic for you`,
      detail: parsed.topic,
      link: `/forum/parking-lot/${data.id}`,
    })
  }

  revalidatePath("/forum/parking-lot")
  redirect(`/forum/parking-lot/${data.id}`)
}

export async function withdrawParkingLotItem(id: string) {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const { error } = await supabase
    .from("parking_lot_items")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("submitter_member_id", me.id)

  if (error) throw new Error(error.message)
  revalidatePath("/forum/parking-lot")
  revalidatePath(`/forum/parking-lot/${id}`)
}

export async function reparkItem(id: string) {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const { data: original, error: fetchErr } = await supabase
    .from("parking_lot_items")
    .select(
      "topic, context, urgency, tool_category, exploration_format"
    )
    .eq("id", id)
    .single()

  if (fetchErr) throw new Error(fetchErr.message)

  const { data: cloned, error: insertErr } = await supabase
    .from("parking_lot_items")
    .insert({
      forum_id: me.forum_id,
      submitter_member_id: me.id,
      added_by_member_id: me.id,
      topic: original.topic,
      context: original.context,
      urgency: original.urgency,
      tool_category: original.tool_category,
      exploration_format: original.exploration_format,
    })
    .select("id")
    .single()

  if (insertErr) throw new Error(insertErr.message)
  revalidatePath("/forum/parking-lot")
  redirect(`/forum/parking-lot/${cloned.id}`)
}
