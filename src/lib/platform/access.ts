import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/**
 * Whether the signed-in account is a platform operator (platform_admins).
 * Answered by a SECURITY DEFINER function; the table itself is never
 * readable from a session.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const { data } = await supabase.rpc("is_platform_admin")
  return data === true
})

export type PlatformForumRow = {
  forum_id: string
  name: string
  status: "active" | "suspended"
  timezone: string
  created_at: string
  founder_name: string | null
  founder_email: string | null
  member_count: number
  admin_count: number
  meeting_count: number
  next_meeting_at: string | null
  ai_calls_30d: number
  last_activity: string | null
}
