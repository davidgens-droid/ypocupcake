"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

async function ensureAdmin() {
  const me = await requireCurrentMember()
  if (!me.is_admin) throw new Error("Admins only.")
  return me
}

// ─── Member invites ─────────────────────────────────────────────────────────
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  is_admin: z.string().optional(),
})

export async function createInvite(formData: FormData) {
  const me = await ensureAdmin()
  const parsed = inviteSchema.parse({
    email: formData.get("email"),
    name: formData.get("name"),
    is_admin: formData.get("is_admin") ?? undefined,
  })

  const supabase = await createClient()
  const { error } = await supabase.from("member_invites").upsert({
    email: parsed.email,
    forum_id: me.forum_id,
    name: parsed.name,
    is_admin: parsed.is_admin === "on",
  })
  if (error) throw new Error(error.message)
  revalidatePath("/admin/members")
}

export async function deleteInvite(formData: FormData) {
  await ensureAdmin()
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  if (!email) return
  const supabase = await createClient()
  const { error } = await supabase
    .from("member_invites")
    .delete()
    .eq("email", email)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/members")
}

// ─── Members (edit profile fields admin can manage) ────────────────────────
const memberPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  birthday: z.string().optional(),
  anniversary: z.string().optional(),
  is_admin: z.string().optional(),
})

export async function updateMember(formData: FormData) {
  await ensureAdmin()
  const parsed = memberPatchSchema.parse({
    id: formData.get("id"),
    name: formData.get("name"),
    birthday: formData.get("birthday") || undefined,
    anniversary: formData.get("anniversary") || undefined,
    is_admin: formData.get("is_admin") ?? undefined,
  })

  const supabase = await createClient()
  const { error } = await supabase
    .from("members")
    .update({
      name: parsed.name,
      birthday: parsed.birthday || null,
      anniversary: parsed.anniversary || null,
      is_admin: parsed.is_admin === "on",
    })
    .eq("id", parsed.id)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/members")
}

// ─── Roles ─────────────────────────────────────────────────────────────────
const roleSchema = z.object({
  member_id: z.string().uuid().nullable(),
  role_type: z.enum([
    "moderator",
    "assistant_moderator",
    "czar",
    "secretary",
    "treasurer",
    "technology",
    "retreat_planner",
    "timekeeper",
    "norm_observer",
    "social_coordinator",
  ]),
  year: z.coerce.number().int().min(2024).max(2100),
})

export async function setSingletonRole(formData: FormData) {
  // Sets the single holder of moderator / assistant_moderator / czar for a year.
  const me = await ensureAdmin()
  const memberIdRaw = formData.get("member_id")
  const parsed = roleSchema.parse({
    member_id: memberIdRaw === "" ? null : memberIdRaw,
    role_type: formData.get("role_type"),
    year: formData.get("year"),
  })

  const supabase = await createClient()

  // Clear any existing holder for this role/year/forum.
  const { error: delErr } = await supabase
    .from("roles")
    .delete()
    .eq("forum_id", me.forum_id)
    .eq("role_type", parsed.role_type)
    .eq("year", parsed.year)
  if (delErr) throw new Error(delErr.message)

  if (parsed.member_id) {
    const { error: insErr } = await supabase.from("roles").insert({
      forum_id: me.forum_id,
      member_id: parsed.member_id,
      role_type: parsed.role_type,
      year: parsed.year,
    })
    if (insErr) throw new Error(insErr.message)
  }

  revalidatePath("/admin/roles")
}

// ─── Meetings ──────────────────────────────────────────────────────────────
const newMeetingSchema = z.object({
  scheduled_at_local: z.string().min(1), // datetime-local string from input
  location: z.string().trim().max(200).optional().default(""),
  host_member_id: z.string().uuid().optional().or(z.literal("")),
})

export async function createMeeting(formData: FormData) {
  const me = await ensureAdmin()
  const parsed = newMeetingSchema.parse({
    scheduled_at_local: formData.get("scheduled_at_local"),
    location: formData.get("location") ?? "",
    host_member_id: formData.get("host_member_id") ?? "",
  })

  const supabase = await createClient()
  const isoDate = new Date(parsed.scheduled_at_local).toISOString()
  const { error } = await supabase.from("meetings").insert({
    forum_id: me.forum_id,
    scheduled_at: isoDate,
    location: parsed.location.trim() || null,
    host_member_id: parsed.host_member_id || null,
  })
  if (error) throw new Error(error.message)
  revalidatePath("/admin/meetings")
  revalidatePath("/dashboard")
}

const updateMeetingSchema = newMeetingSchema.extend({
  id: z.string().uuid(),
  status: z.enum(["upcoming", "in_progress", "closed", "cancelled"]),
})

export async function updateMeeting(formData: FormData) {
  await ensureAdmin()
  const parsed = updateMeetingSchema.parse({
    id: formData.get("id"),
    scheduled_at_local: formData.get("scheduled_at_local"),
    location: formData.get("location") ?? "",
    host_member_id: formData.get("host_member_id") ?? "",
    status: formData.get("status"),
  })

  const supabase = await createClient()
  const { error } = await supabase
    .from("meetings")
    .update({
      scheduled_at: new Date(parsed.scheduled_at_local).toISOString(),
      location: parsed.location.trim() || null,
      host_member_id: parsed.host_member_id || null,
      status: parsed.status,
    })
    .eq("id", parsed.id)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/meetings")
  revalidatePath("/dashboard")
}

export async function deleteMeeting(formData: FormData) {
  await ensureAdmin()
  const id = String(formData.get("id") ?? "")
  const supabase = await createClient()
  const { error } = await supabase.from("meetings").delete().eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/meetings")
  revalidatePath("/dashboard")
}

// ─── Charter ────────────────────────────────────────────────────────────────
const charterSchema = z.object({
  charter: z.string().max(50_000),
})

export async function saveCharter(formData: FormData) {
  const me = await ensureAdmin()
  const parsed = charterSchema.parse({ charter: formData.get("charter") ?? "" })

  const supabase = await createClient()
  // Charter lives in `forums.settings_json.charter` for V1 simplicity.
  const { data: forum } = await supabase
    .from("forums")
    .select("settings")
    .eq("id", me.forum_id)
    .single()

  const next = {
    ...((forum?.settings as Record<string, unknown>) ?? {}),
    charter: parsed.charter,
    charter_updated_at: new Date().toISOString(),
    charter_updated_by: me.id,
  }

  const { error } = await supabase
    .from("forums")
    .update({ settings: next })
    .eq("id", me.forum_id)
  if (error) throw new Error(error.message)
  revalidatePath("/admin/charter")
}
