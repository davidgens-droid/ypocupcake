import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/** Whether the signed-in member has completed the one-time protection setup. */
export const hasEncryptionSetup = cache(async (memberId: string): Promise<boolean> => {
  const supabase = await createClient()
  const { count } = await supabase
    .from("member_key_wraps")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
  return (count ?? 0) > 0
})
