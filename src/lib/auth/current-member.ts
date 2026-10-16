import { cache } from "react"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export type CurrentForum = {
  id: string
  name: string
  timezone: string
  status: "active" | "suspended"
}

export type CurrentMember = {
  id: string
  forum_id: string
  email: string
  name: string
  photo_url: string | null
  is_admin: boolean
  /** The member's forum: name for the UI, timezone for every meeting time. */
  forum: CurrentForum
}

/**
 * The signed-in, ACTIVE member of an ACTIVE forum, or null. (A removed
 * member, or a member of a suspended forum, reads nothing under RLS — use
 * getMembershipStatus() to tell them why.)
 *
 * Wrapped in React's per-request cache: the app layout, the header and the
 * page each ask for the member, and one round trip per request is enough.
 */
export const getCurrentMember = cache(async (): Promise<CurrentMember | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("members")
    .select("id, forum_id, email, name, photo_url, is_admin, forums(id, name, timezone, status)")
    .eq("id", user.id)
    .maybeSingle()
  if (!data) return null

  // PostgREST returns the embedded forum as an object for a to-one FK, but
  // the generated-less client types it loosely.
  const forum = (Array.isArray(data.forums) ? data.forums[0] : data.forums) as CurrentForum | null
  if (!forum) return null
  // Last line of defence: a zone the renderer can't handle must never take
  // every page of the forum down. The RPC validates on write; this guards
  // against anything that slipped past it (or an older row).
  forum.timezone = renderableTimezone(forum.timezone)

  return {
    id: data.id,
    forum_id: data.forum_id,
    email: data.email,
    name: data.name,
    photo_url: data.photo_url,
    is_admin: data.is_admin,
    forum,
  }
})

function renderableTimezone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    console.warn("[current-member] forum timezone not renderable; using UTC", { tz })
    return "UTC"
  }
}

export type MembershipStatus =
  | { kind: "member"; forumName: string }
  | { kind: "removed"; forumName: string }
  | { kind: "suspended"; forumName: string }
  /** Signed in, but the account belongs to no forum yet → onboarding. */
  | { kind: "none" }
  | { kind: "anonymous" }

/**
 * Which case is the caller in? Backed by a SECURITY DEFINER RPC that returns
 * only the two statuses and the forum name, for ANY membership state.
 */
export const getMembershipStatus = cache(async (): Promise<MembershipStatus> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: "anonymous" }
  const { data } = await supabase.rpc("my_forum_status").maybeSingle()
  if (!data) return { kind: "none" }
  const row = data as { forum_name: string; forum_status: string; member_status: string }
  if (row.member_status === "removed") return { kind: "removed", forumName: row.forum_name }
  if (row.forum_status !== "active") return { kind: "suspended", forumName: row.forum_name }
  return { kind: "member", forumName: row.forum_name }
})

/**
 * Server helper: ensures the request is authenticated and the caller is an
 * active member of an active forum. Otherwise sends them to the page that
 * explains why (or lets them create/join a forum). Use in protected page
 * server components.
 */
export async function requireCurrentMember(): Promise<CurrentMember> {
  const member = await getCurrentMember()
  if (member) return member
  const status = await getMembershipStatus()
  if (status.kind === "removed") redirect("/removed")
  if (status.kind === "suspended") redirect("/suspended")
  if (status.kind === "none") redirect("/onboarding")
  redirect("/login")
}
