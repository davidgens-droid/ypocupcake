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

/**
 * Insert a notification for another member. Uses the SECURITY DEFINER RPC so
 * the actor doesn't need write access on the recipient's row. Safe to call
 * from any server action run by an authenticated user.
 */
export async function notifyMember(args: {
  memberId: string
  kind: string
  title: string
  detail?: string
  link?: string
}) {
  const supabase = await createClient()
  await supabase.rpc("create_notification", {
    p_member_id: args.memberId,
    p_kind: args.kind,
    p_title: args.title,
    p_detail: args.detail ?? null,
    p_link: args.link ?? null,
  })
}
