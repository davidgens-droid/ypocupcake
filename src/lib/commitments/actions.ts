"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "done", "carried_over", "dropped"]),
  notes: z.string().max(2000).optional().default(""),
})

export async function updateCommitment(formData: FormData) {
  const me = await requireCurrentMember()
  const parsed = updateSchema.parse({
    id: formData.get("id"),
    status: formData.get("status"),
    notes: formData.get("notes") ?? "",
  })

  const supabase = await createClient()

  const { error } = await supabase
    .from("commitments")
    .update({
      status: parsed.status,
      notes: parsed.notes.trim() || null,
    })
    .eq("id", parsed.id)
    .eq("member_id", me.id)

  if (error) throw new Error(error.message)
  revalidatePath("/forum/commitments")
  revalidatePath(`/forum/commitments/${parsed.id}`)
  revalidatePath("/dashboard")
}

const newSchema = z.object({
  text: z.string().trim().min(1).max(500),
  due_date: z.string().optional(),
})

export async function createCommitment(formData: FormData) {
  const me = await requireCurrentMember()
  const parsed = newSchema.parse({
    text: formData.get("text"),
    due_date: formData.get("due_date") || undefined,
  })

  const supabase = await createClient()
  const { error } = await supabase.from("commitments").insert({
    forum_id: me.forum_id,
    member_id: me.id,
    text: parsed.text,
    due_date: parsed.due_date || null,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/forum/commitments")
  revalidatePath("/dashboard")
}
