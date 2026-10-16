import Link from "next/link"
import { redirect } from "next/navigation"
import { KeyRound, Link2, Sparkles } from "lucide-react"

import { InviteLinkEntry } from "@/components/onboarding/invite-link-entry"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getMembershipStatus } from "@/lib/auth/current-member"
import { isSignupEnabled } from "@/lib/forums/signup"

/**
 * The front door. A visitor can't be told apart from a member, so every
 * path is offered: sign in, use an invite link, or (while sign-up is open)
 * set up a new forum. Anyone already signed in is sent where they belong.
 */
export default async function LandingPage() {
  const status = await getMembershipStatus()
  if (status.kind === "member") redirect("/dashboard")
  if (status.kind === "none") redirect("/onboarding")
  if (status.kind === "removed") redirect("/removed")
  if (status.kind === "suspended") redirect("/suspended")

  const signupEnabled = await isSignupEnabled()

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-12">
      <div className="space-y-4 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
        <h1 className="font-heading text-4xl font-semibold leading-tight text-balance sm:text-5xl">
          The forum companion
        </h1>
        <p className="text-muted-foreground text-balance">
          Prep your update, run your meeting, and stay connected with your
          forum between gatherings.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" /> Already a member?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in with your email. We&apos;ll send a 6-digit code; no password.
            </p>
            <Button className="w-full" render={<Link href="/login" />}>
              Sign in
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> New forum?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {signupEnabled ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Set up Cupcake for your forum in a minute. You&apos;ll be its
                  admin and get a link to invite your members.
                </p>
                <Button variant="outline" className="w-full" render={<Link href="/signup" />}>
                  Set up a new forum
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                New forums aren&apos;t open yet. If your forum already uses
                Cupcake, its admin can send you an invite link.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" /> Have an invite link?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Opening the link is enough. If you were sent it as text, paste it here.
          </p>
          <InviteLinkEntry />
        </CardContent>
      </Card>
    </main>
  )
}
