import { NextResponse } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = searchParams.get("next") ?? "/dashboard"

  // Helpful for debugging email-template / flow mismatches.
  console.log(
    "[auth/callback] received params:",
    Object.fromEntries(searchParams)
  )

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

  // Confirm the user has a member row (i.e. was invited).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`)
  }

  const { data: member } = await supabase
    .from("members")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()

  if (!member) {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/login?error=not_invited`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
