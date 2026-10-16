import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/app/nav/sign-out-button"
import { OnboardingChoice } from "@/components/onboarding/onboarding-choice"
import { getMembershipStatus } from "@/lib/auth/current-member"
import { isSignupEnabled } from "@/lib/forums/signup"
import { createClient } from "@/lib/supabase/server"

/**
 * Signed in, but the account belongs to no forum yet: create one (when
 * signups are open) or paste an invite link. Everyone else is sent where
 * they belong.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>
}) {
  const status = await getMembershipStatus()
  if (status.kind === "anonymous") redirect("/login")
  if (status.kind === "member") redirect("/dashboard")
  if (status.kind === "removed") redirect("/removed")
  if (status.kind === "suspended") redirect("/suspended")

  const { intent } = await searchParams
  const signupEnabled = await isSignupEnabled()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Server-side list so the <select> renders identically on both ends.
  const timezones = Intl.supportedValuesOf("timeZone")

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <header className="space-y-1 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
        <h1 className="font-heading text-2xl font-semibold">Welcome</h1>
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as {user?.email}. This account doesn&apos;t belong
          to a forum yet.
        </p>
      </header>

      <OnboardingChoice
        signupEnabled={signupEnabled}
        timezones={timezones}
        createFirst={intent === "create"}
      />

      <div className="flex justify-center">
        <SignOutButton />
      </div>
    </main>
  )
}
