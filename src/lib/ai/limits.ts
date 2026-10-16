import { createHash } from "node:crypto"

import type { CurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

/**
 * Fair use of the shared AI keys across forums. Counted from ai_interactions
 * (one row per call, token counts only) over a rolling 24 hours. Generous
 * for real use — a forum of ten doing a monthly update each is ~50 calls —
 * and tight enough that a runaway loop in one forum can't starve the others.
 */
export const AI_LIMITS = {
  perMemberPerDay: 60,
  perForumPerDay: 300,
} as const

export const AI_BUSY_MESSAGE =
  "The AI has been busy for your forum today — try again a little later."

export type AiBudget = { ok: true } | { ok: false; error: string }

/** Call before any Anthropic/OpenAI request made on a member's behalf. */
export async function checkAiBudget(me: CurrentMember): Promise<AiBudget> {
  const supabase = await createClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ count: mine }, { data: forumCount }] = await Promise.all([
    supabase
      .from("ai_interactions")
      .select("id", { count: "exact", head: true })
      .eq("member_id", me.id)
      .gt("created_at", since),
    supabase.rpc("forum_ai_calls_today"),
  ])
  if ((mine ?? 0) >= AI_LIMITS.perMemberPerDay) return { ok: false, error: AI_BUSY_MESSAGE }
  if (typeof forumCount === "number" && forumCount >= AI_LIMITS.perForumPerDay) {
    return { ok: false, error: AI_BUSY_MESSAGE }
  }
  return { ok: true }
}

/**
 * Opaque, stable per-member identifier for Anthropic's `metadata.user_id`:
 * attributable for spend/abuse review, never identifying.
 */
export function aiMetadata(me: CurrentMember): { user_id: string } {
  return {
    user_id: createHash("sha256").update(`${me.forum_id}:${me.id}`).digest("hex"),
  }
}
