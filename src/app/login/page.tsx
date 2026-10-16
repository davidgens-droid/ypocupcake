import { Suspense } from "react"

import { LoginForm } from "@/components/auth/login-form"
import { isSignupEnabled } from "@/lib/forums/signup"

export default async function LoginPage() {
  const signupEnabled = await isSignupEnabled()
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <Suspense>
        <LoginForm mode="login" signupEnabled={signupEnabled} />
      </Suspense>
    </main>
  )
}
