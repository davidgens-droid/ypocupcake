"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { canRunMeetings, getMyRoles } from "@/lib/auth/roles"
import { forumLocalInputToISO } from "@/lib/dates"
import { createClient } from "@/lib/supabase/server"

async function ensureAdmin() {
  const me = await requireCurrentMember()
  if (!me.is_admin) throw new Error("Admins only.")
  return me
}

/** Admin OR Moderator OR Assistant Moderator — for actions on meetings. */
async function ensureMeetingManager() {
  const me = await requireCurrentMember()
  if (me.is_admin) return me
  const roles = await getMyRoles(me)
  if (!canRunMeetings(me, roles)) throw new Error("Admin or Moderator only.")
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

  // User sessions can no longer update identity columns on members (0017);
  // admin edits go through the same-forum SECURITY DEFINER RPC, which can
  // never touch forum_id / email / id and refuses to demote the last admin.
  const supabase = await createClient()
  const { error } = await supabase.rpc("admin_update_member", {
    p_member_id: parsed.id,
    p_patch: {
      name: parsed.name,
      birthday: parsed.birthday || "",
      anniversary: parsed.anniversary || "",
      is_admin: parsed.is_admin === "on",
    },
  })
  if (error) throw new Error(friendlyRpcError(error.message))
  revalidatePath("/admin/members")
}

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Remove a member from the forum (access ends immediately; data is kept).
 * Returns a result rather than throwing: production scrubs thrown Server
 * Action messages, and "that would leave no admin" must be readable.
 */
export async function removeMember(memberId: string): Promise<ActionResult> {
  await ensureAdmin()
  const parsed = z.string().uuid().safeParse(memberId)
  if (!parsed.success) return { ok: false, error: "Invalid member." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_member", { p_member_id: parsed.data })
  if (error) return { ok: false, error: friendlyRpcError(error.message) }
  revalidatePath("/admin/members")
  revalidatePath("/forum/members")
  return { ok: true }
}

export async function restoreMember(memberId: string): Promise<ActionResult> {
  await ensureAdmin()
  const parsed = z.string().uuid().safeParse(memberId)
  if (!parsed.success) return { ok: false, error: "Invalid member." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_member", { p_member_id: parsed.data })
  if (error) return { ok: false, error: friendlyRpcError(error.message) }
  revalidatePath("/admin/members")
  revalidatePath("/forum/members")
  return { ok: true }
}

/** Map the RPCs' stable error codes to copy. */
function friendlyRpcError(message: string): string {
  if (message.includes("last_admin")) return "That would leave the forum with no admin."
  if (message.includes("cannot_remove_self")) return "You can't remove yourself."
  if (message.includes("member_not_in_forum")) return "That member isn't in your forum."
  if (message.includes("not_admin")) return "Admins only."
  return message
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

export async function setSingletonRole(formData: FormData): Promise<ActionResult> {
  // Sets the single holder of moderator / assistant_moderator / czar for a year.
  const me = await ensureAdmin()
  const memberIdRaw = formData.get("member_id")
  const parsed = roleSchema.safeParse({
    member_id: memberIdRaw === "" ? null : memberIdRaw,
    role_type: formData.get("role_type"),
    year: formData.get("year"),
  })
  if (!parsed.success) return { ok: false, error: "Invalid role assignment." }

  const supabase = await createClient()

  // The composite FK (0018) already refuses a member from another forum;
  // returned (not thrown) so the admin reads the reason in production.
  if (parsed.data.member_id) {
    const { data: target } = await supabase
      .from("members")
      .select("id")
      .eq("id", parsed.data.member_id)
      .eq("forum_id", me.forum_id)
      .eq("status", "active")
      .maybeSingle()
    if (!target) return { ok: false, error: "That member isn't an active member of your forum." }
  }

  // Clear any existing holder for this role/year/forum.
  const { error: delErr } = await supabase
    .from("roles")
    .delete()
    .eq("forum_id", me.forum_id)
    .eq("role_type", parsed.data.role_type)
    .eq("year", parsed.data.year)
  if (delErr) return { ok: false, error: "Couldn't update the role. Try again." }

  if (parsed.data.member_id) {
    const { error: insErr } = await supabase.from("roles").insert({
      forum_id: me.forum_id,
      member_id: parsed.data.member_id,
      role_type: parsed.data.role_type,
      year: parsed.data.year,
    })
    if (insErr) return { ok: false, error: "Couldn't update the role. Try again." }
  }

  revalidatePath("/admin/roles")
  return { ok: true }
}

// ─── Meetings ──────────────────────────────────────────────────────────────
const newMeetingSchema = z.object({
  scheduled_at_local: z.string().min(1), // datetime-local string from input
  location: z.string().trim().max(200).optional().default(""),
  host_member_id: z.string().uuid().optional().or(z.literal("")),
})

export async function createMeeting(formData: FormData) {
  const me = await ensureMeetingManager()
  const parsed = newMeetingSchema.parse({
    scheduled_at_local: formData.get("scheduled_at_local"),
    location: formData.get("location") ?? "",
    host_member_id: formData.get("host_member_id") ?? "",
  })

  const supabase = await createClient()
  const isoDate = forumLocalInputToISO(parsed.scheduled_at_local)
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
  await ensureMeetingManager()
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
      scheduled_at: forumLocalInputToISO(parsed.scheduled_at_local),
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
  await ensureMeetingManager()
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
