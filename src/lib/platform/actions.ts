"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

function friendlyPlatformError(message: string): string {
  if (message.includes("not_platform_admin")) return "Platform operators only."
  if (message.includes("forum_not_found")) return "That forum no longer exists."
  if (message.includes("invalid_status")) return "Status must be active or suspended."
  if (message.includes("own_forum")) return "You can't pause your own forum from here — it would lock you out as well."
  return "Something went wrong. Please try again."
}

/** Pause a forum (its members read nothing and see /suspended) or reactivate it. */
export async function setForumStatus(input: {
  forumId: string
  status: "active" | "suspended"
}): Promise<ActionResult> {
  const parsed = z
    .object({ forumId: z.string().uuid(), status: z.enum(["active", "suspended"]) })
    .safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid request." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("platform_set_forum_status", {
    p_forum_id: parsed.data.forumId,
    p_status: parsed.data.status,
  })
  if (error) return { ok: false, error: friendlyPlatformError(error.message) }
  revalidatePath("/platform")
  return { ok: true }
}

/** Open or close public forum creation (platform_settings.signup_enabled). */
export async function setSignupEnabled(enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("platform_set_signup_enabled", { p_enabled: !!enabled })
  if (error) return { ok: false, error: friendlyPlatformError(error.message) }
  revalidatePath("/platform")
  revalidatePath("/login")
  revalidatePath("/signup")
  return { ok: true }
}
