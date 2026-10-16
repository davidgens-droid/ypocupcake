"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Thin wrappers over the onboarding RPCs (0021). Every one returns
 * {ok, error} rather than throwing: production scrubs thrown Server Action
 * messages, and "that link has expired" has to reach the person.
 */

/** Spec §11: the RPCs raise stable codes; map them to copy here. */
function friendlyForumError(message: string): string {
  const has = (code: string) => message.includes(code)
  if (has("already_member"))
    return "This account already belongs to a forum. An account can belong to only one forum — sign in with a different email to create or join another."
  if (has("signup_disabled")) return "Creating new forums isn't open yet."
  if (has("invalid_token") || has("unknown")) return "That invite link isn't valid. Check it was copied completely."
  if (has("expired")) return "That invite link has expired. Ask your forum's admin for a fresh one."
  if (has("revoked")) return "That invite link was revoked. Ask your forum's admin for a fresh one."
  if (has("exhausted")) return "That invite link has been used as many times as it allows. Ask your forum's admin for a fresh one."
  if (has("forum_suspended")) return "That forum is paused and isn't taking new members right now."
  if (has("invalid_name")) return "Give the forum a name between 2 and 80 characters."
  if (has("invalid_admin_name")) return "Enter your name (up to 120 characters)."
  if (has("invalid_timezone")) return "Pick a timezone from the list."
  if (has("invalid_expiry")) return "Links can last between 1 and 90 days."
  if (has("invalid_max_uses")) return "A link can allow between 1 and 200 joins, or be unlimited."
  if (has("link_not_found")) return "That link doesn't belong to your forum."
  if (has("not_admin")) return "Admins only."
  if (has("not_authenticated")) return "You're signed out. Sign in and try again."
  if (has("no_email")) return "Your account has no email address, so it can't join a forum."
  return "Something went wrong. Please try again."
}

const createForumSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(1).max(64),
  adminName: z.string().trim().min(1).max(120),
})

export async function createForum(input: {
  name: string
  timezone: string
  adminName: string
}): Promise<ActionResult> {
  const parsed = createForumSchema.safeParse(input)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return {
      ok: false,
      error:
        field === "name"
          ? "Give the forum a name between 2 and 80 characters."
          : field === "adminName"
            ? "Enter your name."
            : "Pick a timezone from the list.",
    }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_forum", {
    p_name: parsed.data.name,
    p_timezone: parsed.data.timezone,
    p_admin_name: parsed.data.adminName,
  })
  if (error) return { ok: false, error: friendlyForumError(error.message) }
  revalidatePath("/", "layout")
  return { ok: true }
}

const joinSchema = z.object({
  token: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
})

export async function joinForum(input: { token: string; name: string }): Promise<ActionResult> {
  const parsed = joinSchema.safeParse(input)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0]
    return {
      ok: false,
      error: field === "name" ? "Enter your name." : "That invite link isn't valid.",
    }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("join_forum", {
    p_token: parsed.data.token,
    p_name: parsed.data.name,
  })
  if (error) return { ok: false, error: friendlyForumError(error.message) }
  revalidatePath("/", "layout")
  return { ok: true }
}

const inviteLinkSchema = z.object({
  expiresDays: z.number().int().min(1).max(90),
  maxUses: z.number().int().min(1).max(200).nullable(),
})

export async function createInviteLink(input: {
  expiresDays: number
  maxUses: number | null
}): Promise<ActionResult> {
  const parsed = inviteLinkSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "Links last 1–90 days and allow 1–200 joins (or unlimited)." }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_invite_link", {
    p_expires_days: parsed.data.expiresDays,
    p_max_uses: parsed.data.maxUses,
  })
  if (error) return { ok: false, error: friendlyForumError(error.message) }
  revalidatePath("/admin/invite")
  return { ok: true }
}

export async function revokeInviteLink(linkId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(linkId)
  if (!parsed.success) return { ok: false, error: "That link doesn't belong to your forum." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_invite_link", { p_link_id: parsed.data })
  if (error) return { ok: false, error: friendlyForumError(error.message) }
  revalidatePath("/admin/invite")
  return { ok: true }
}
