import type { CurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export type RoleType =
  | "moderator"
  | "assistant_moderator"
  | "czar"
  | "host"
  | "admin"
  | "secretary"
  | "treasurer"
  | "technology"
  | "retreat_planner"
  | "timekeeper"
  | "norm_observer"
  | "social_coordinator"

/**
 * The caller's roles for the current calendar year, in THEIR forum only.
 * The one place role lookups happen server-side, so the forum filter can't
 * be forgotten (the database's has_role() is forum-scoped the same way).
 */
export async function getMyRoles(me: CurrentMember): Promise<Set<RoleType>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("forum_id", me.forum_id)
    .eq("year", new Date().getFullYear())
  return new Set((data ?? []).map((r) => r.role_type as RoleType))
}

export function hasAny(roles: Set<RoleType>, ...wanted: RoleType[]): boolean {
  return wanted.some((r) => roles.has(r))
}

/** Moderator, assistant moderator, or admin — the people who run meetings. */
export function canRunMeetings(me: CurrentMember, roles: Set<RoleType>): boolean {
  return me.is_admin || hasAny(roles, "moderator", "assistant_moderator")
}

/** Czar, moderator, assistant moderator, or admin — parking-lot privileges. */
export function isParkingLotPrivileged(me: CurrentMember, roles: Set<RoleType>): boolean {
  return me.is_admin || hasAny(roles, "czar", "moderator", "assistant_moderator")
}
