"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { canRunMeetings, getMyRoles } from "@/lib/auth/roles"
import { forumLocalInputToISO } from "@/lib/dates"
import { CHARTER_MAX_BYTES, CHARTER_MIME_BY_EXT, parseCharterSettings } from "@/lib/forums/charter"
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

// (Email invites are gone: members join through the forum's invite link —
// see src/lib/forums/actions.ts.)

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
  if (message.includes("invalid_name")) return "Give the forum a name between 2 and 80 characters."
  if (message.includes("invalid_timezone")) return "That timezone isn't recognised. Pick one from the list."
  if (message.includes("charter_too_long")) return "The charter is over 50,000 characters."
  if (message.includes("invalid_document")) return "That file couldn't be attached. Upload a PDF, Word, text or image file under 20 MB."
  if (message.includes("document_not_found")) return "The upload didn't complete. Please try again."
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
  const isoDate = forumLocalInputToISO(parsed.scheduled_at_local, me.forum.timezone)
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
  const me = await ensureMeetingManager()
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
      scheduled_at: forumLocalInputToISO(parsed.scheduled_at_local, me.forum.timezone),
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

// ─── Forum settings (name, timezone, charter) ───────────────────────────────
//
// User sessions have no UPDATE grant on `forums` at all (0020): the only
// write path is the same-forum-admin RPC update_forum_settings(), which
// validates the timezone against Postgres' own zone table and stamps the
// charter's updated_at/by itself.

const charterSchema = z.object({
  charter: z.string().max(50_000),
})

export async function saveCharter(input: { charter: string }): Promise<ActionResult> {
  await ensureAdmin()
  const parsed = charterSchema.safeParse({ charter: input.charter ?? "" })
  if (!parsed.success) return { ok: false, error: "The charter is over 50,000 characters." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_forum_settings", {
    p_charter: parsed.data.charter,
  })
  if (error) return { ok: false, error: friendlyRpcError(error.message) }
  revalidatePath("/admin/charter")
  revalidatePath("/forum/charter")
  return { ok: true }
}

// ─── Charter as an uploaded document ────────────────────────────────────────
//
// The browser uploads straight to the private 'charters' bucket (0023:
// only the forum's admins may write under the forum's prefix), then calls
// setCharterDocument() to record it. The RPC re-checks that the path is
// under the caller's forum and that the object really exists.

async function currentCharterDocumentPath(forumId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from("forums").select("settings").eq("id", forumId).maybeSingle()
  return parseCharterSettings(data?.settings).document?.path ?? null
}

export async function setCharterDocument(input: {
  path: string
  name: string
  size: number
  type: string
}): Promise<ActionResult> {
  const me = await ensureAdmin()
  const schema = z.object({
    path: z.string().regex(new RegExp(`^${me.forum_id}/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`)),
    name: z.string().trim().min(1).max(200),
    size: z.number().int().min(1).max(CHARTER_MAX_BYTES),
    type: z.enum(Object.values(CHARTER_MIME_BY_EXT) as [string, ...string[]]),
  })
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "That file couldn't be attached. Upload a PDF, Word, text or image file under 20 MB." }
  }

  const supabase = await createClient()
  const previous = await currentCharterDocumentPath(me.forum_id)
  const { error } = await supabase.rpc("set_charter_document", { p_document: parsed.data })
  if (error) {
    // Don't leave the fresh upload dangling.
    await supabase.storage.from("charters").remove([parsed.data.path])
    return { ok: false, error: friendlyRpcError(error.message) }
  }
  if (previous && previous !== parsed.data.path) {
    await supabase.storage.from("charters").remove([previous])
  }
  revalidatePath("/admin/charter")
  revalidatePath("/forum/charter")
  return { ok: true }
}

export async function removeCharterDocument(): Promise<ActionResult> {
  const me = await ensureAdmin()
  const supabase = await createClient()
  const previous = await currentCharterDocumentPath(me.forum_id)
  const { error } = await supabase.rpc("set_charter_document", { p_document: null })
  if (error) return { ok: false, error: friendlyRpcError(error.message) }
  if (previous) await supabase.storage.from("charters").remove([previous])
  revalidatePath("/admin/charter")
  revalidatePath("/forum/charter")
  return { ok: true }
}

// The timezone is validated by the RPC (against Postgres' zone table and the
// canonical Area/Location shape), not here: a runtime whose Intl list is
// older than the stored zone must still let the admin rename the forum.
const forumSettingsSchema = z.object({
  name: z.string().trim().min(2, "Give the forum a name (2–80 characters).").max(80, "Keep the name under 80 characters."),
  timezone: z.string().trim().min(1, "Pick a timezone.").max(64, "Pick a timezone from the list."),
})

export async function saveForumSettings(input: {
  name: string
  timezone: string
}): Promise<ActionResult> {
  await ensureAdmin()
  const parsed = forumSettingsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_forum_settings", {
    p_name: parsed.data.name,
    p_timezone: parsed.data.timezone,
  })
  if (error) return { ok: false, error: friendlyRpcError(error.message) }

  // The name is in the shell (sidebar/header) and meeting times are
  // rendered in the zone on every page: refresh the whole tree.
  revalidatePath("/", "layout")
  return { ok: true }
}
