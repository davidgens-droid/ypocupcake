import { createClient } from "@/lib/supabase/server"

/**
 * Whether public forum creation is open: platform_settings.signup_enabled,
 * the single switch the create_forum() RPC also enforces. A plain server
 * helper (not a Server Action) so it is never exposed as an endpoint.
 */
export async function isSignupEnabled(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("signup_enabled")
  return data === true
}
