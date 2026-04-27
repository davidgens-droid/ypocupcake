import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export type CurrentMember = {
  id: string
  forum_id: string
  email: string
  name: string
  photo_url: string | null
  is_admin: boolean
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("members")
    .select("id, forum_id, email, name, photo_url, is_admin")
    .eq("id", user.id)
    .maybeSingle()

  return data ?? null
}

/**
 * Server helper: ensures the request is authenticated and a member row exists.
 * Redirects to /login if not. Use in protected page server components.
 */
export async function requireCurrentMember(): Promise<CurrentMember> {
  const member = await getCurrentMember()
  if (!member) redirect("/login")
  return member
}
