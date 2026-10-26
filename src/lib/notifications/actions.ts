"use server"

import { revalidatePath } from "next/cache"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export type Notification = {
  id: string
  kind: string
  title: string
  detail: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export async function listNotifications(): Promise<Notification[]> {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, detail, link, read_at, created_at")
    .eq("member_id", me.id)
    .order("created_at", { ascending: false })
    .limit(30)
  return data ?? []
}

export async function getUnreadCount(): Promise<number> {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("member_id", me.id)
    .is("read_at", null)
  return count ?? 0
}

export async function markRead(id: string) {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("member_id", me.id)
  revalidatePath("/")
}

export async function markAllRead() {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", me.id)
    .is("read_at", null)
  revalidatePath("/")
}

export type NotificationKind = "topic_added_on_behalf" | "photo_comment" | "photo_added" | "photos_added"

/** The kinds that may be fanned out to a whole forum (the database enforces the same list). */
export type ForumNotificationKind = "photo_added" | "photos_added"

/**
 * One notification for every OTHER active member of the caller's forum,
 * composed and validated exactly like notifyMember's (the RPC calls
 * create_notification per recipient). Returns how many were notified.
 */
export async function notifyForum(args: { kind: ForumNotificationKind; detail?: string; link?: string }): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("notify_forum_members", {
    p_kind: args.kind,
    p_detail: args.detail ?? null,
    p_link: args.link ?? null,
  })
  if (error) throw new Error(error.message)
  return typeof data === "number" ? data : 0
}

/**
 * Insert a notification for another member of the caller's forum. The
 * SECURITY DEFINER RPC composes the title from the CALLER's own name and the
 * kind (a caller can't put someone else's name on it), refuses recipients
 * outside the forum, and only accepts relative links.
 */
export async function notifyMember(args: {
  memberId: string
  kind: NotificationKind
  detail?: string
  link?: string
}) {
  const supabase = await createClient()
  await supabase.rpc("create_notification", {
    p_member_id: args.memberId,
    p_kind: args.kind,
    p_detail: args.detail ?? null,
    p_link: args.link ?? null,
  })
}
