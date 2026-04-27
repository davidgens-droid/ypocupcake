"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const recordSchema = z.object({
  storage_path: z.string().min(1),
  caption: z.string().max(500).optional().default(""),
  taken_at: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
})

export async function recordPhoto(input: z.infer<typeof recordSchema>) {
  const me = await requireCurrentMember()
  const parsed = recordSchema.parse(input)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("photos")
    .insert({
      forum_id: me.forum_id,
      uploader_member_id: me.id,
      storage_path: parsed.storage_path,
      caption: parsed.caption.trim() || null,
      taken_at: parsed.taken_at || null,
      tags: parsed.tags,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  revalidatePath("/forum/photos")
  return { id: data.id as string }
}

export async function deletePhoto(formData: FormData) {
  const me = await requireCurrentMember()
  const id = String(formData.get("id") ?? "")
  if (!id) return

  const supabase = await createClient()
  const { data: photo, error: fetchErr } = await supabase
    .from("photos")
    .select("id, uploader_member_id, storage_path")
    .eq("id", id)
    .single()

  if (fetchErr || !photo || photo.uploader_member_id !== me.id) {
    throw new Error("Not allowed.")
  }

  await supabase.storage.from("photos").remove([photo.storage_path])
  const { error: delErr } = await supabase.from("photos").delete().eq("id", id)
  if (delErr) throw new Error(delErr.message)

  revalidatePath("/forum/photos")
}

export async function toggleReaction(formData: FormData) {
  const me = await requireCurrentMember()
  const photoId = String(formData.get("photo_id") ?? "")
  const emoji = String(formData.get("emoji") ?? "").trim().slice(0, 8)
  if (!photoId || !emoji) return

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from("photo_reactions")
    .select("photo_id")
    .eq("photo_id", photoId)
    .eq("member_id", me.id)
    .eq("emoji", emoji)
    .maybeSingle()

  if (existing) {
    await supabase
      .from("photo_reactions")
      .delete()
      .eq("photo_id", photoId)
      .eq("member_id", me.id)
      .eq("emoji", emoji)
  } else {
    await supabase
      .from("photo_reactions")
      .insert({ photo_id: photoId, member_id: me.id, emoji })
  }
  revalidatePath(`/forum/photos/${photoId}`)
  revalidatePath("/forum/photos")
}

const commentSchema = z.object({
  photo_id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
})

export async function addComment(formData: FormData) {
  const me = await requireCurrentMember()
  const parsed = commentSchema.parse({
    photo_id: formData.get("photo_id"),
    body: formData.get("body"),
  })

  const supabase = await createClient()
  const { error } = await supabase.from("photo_comments").insert({
    photo_id: parsed.photo_id,
    member_id: me.id,
    body: parsed.body,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/forum/photos/${parsed.photo_id}`)
}

export async function deleteComment(formData: FormData) {
  const me = await requireCurrentMember()
  const id = String(formData.get("id") ?? "")
  const photoId = String(formData.get("photo_id") ?? "")

  const supabase = await createClient()
  const { error } = await supabase
    .from("photo_comments")
    .delete()
    .eq("id", id)
    .eq("member_id", me.id)
  if (error) throw new Error(error.message)
  revalidatePath(`/forum/photos/${photoId}`)
}
