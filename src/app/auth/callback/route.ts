import { NextResponse } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

import { getMembershipStatus } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = searchParams.get("next") ?? "/dashboard"

  // Supabase may bounce back with its own error (e.g. otp_expired). Surface it.
  const supaError = searchParams.get("error_code") ?? searchParams.get("error")
  if (supaError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(supaError)}`
    )
  }

  const supabase = await createClient()

  // Two possible flows depending on Supabase email template:
  //   1. PKCE flow:  ?code=...
  //   2. OTP flow:   ?token_hash=...&type=email|magiclink|recovery|invite
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`
      )
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`
      )
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // Confirm the user belongs to a forum. A removed member, or a member of a
  // suspended forum, still has a membership — they get the page that says
  // why they can't get in, not a "never invited" sign-out.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`)
  }

  const status = await getMembershipStatus()
  if (status.kind === "none") {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=not_invited`)
  }
  if (status.kind === "removed") return NextResponse.redirect(`${origin}/removed`)
  if (status.kind === "suspended") return NextResponse.redirect(`${origin}/suspended`)

  return NextResponse.redirect(`${origin}${next}`)
}
