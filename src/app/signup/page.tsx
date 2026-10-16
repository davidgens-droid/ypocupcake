import { Suspense } from "react"
import Link from "next/link"

import { LoginForm } from "@/components/auth/login-form"
import { Button } from "@/components/ui/button"
import { isSignupEnabled } from "@/lib/forums/signup"

/**
 * Public entry for a NEW forum. The same code-login form as /login with
 * "setting up a forum" copy; after the code, /onboarding asks for the
 * forum's name. Closed (not hidden — the RPC refuses too) until the
 * platform switch is on.
 */
export default async function SignupPage() {
  const signupEnabled = await isSignupEnabled()
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      {signupEnabled ? (
        <Suspense>
          <LoginForm mode="signup" />
        </Suspense>
      ) : (
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
          <h1 className="font-heading text-2xl font-semibold">New forums aren&apos;t open yet</h1>
          <p className="text-sm text-muted-foreground">
            Cupcake is currently invite-only. If your forum already uses it, ask
            your admin for an invite link; it brings you straight in.
          </p>
          <Button variant="outline" render={<Link href="/login" />}>
            Sign in
          </Button>
        </div>
      )}
    </main>
  )
}
