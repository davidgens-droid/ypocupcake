"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

const ERROR_MESSAGES: Record<string, string> = {
  not_invited:
    "That email isn't on the Cupcake invite list. Ask an admin to add you.",
  missing_code: "The sign-in link was malformed. Try again.",
  no_user: "Sign-in completed but no user was returned. Try again.",
  otp_expired:
    "Magic link was already used (often pre-clicked by your email's malware scanner). Use the 6-digit code instead.",
  access_denied:
    "Supabase declined the link. Request a new one and use the 6-digit code.",
}

function LoginPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const errorParam = params.get("error")

  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"email" | "verify">("email")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (errorParam) {
      toast.error(ERROR_MESSAGES[errorParam] ?? errorParam)
    }
  }, [errorParam])

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    setPending(false)

    if (error) {
      toast.error(error.message)
      return
    }
    setStage("verify")
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    })

    if (error) {
      setPending(false)
      toast.error(error.message)
      return
    }

    // Membership check is also done in the server callback; mirror it here
    // so we can surface a helpful error before redirecting.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setPending(false)
      toast.error("Sign-in returned no user.")
      return
    }
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()
    if (!member) {
      await supabase.auth.signOut()
      setPending(false)
      toast.error(ERROR_MESSAGES.not_invited)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="text-sm tracking-wide text-muted-foreground uppercase">
            Cupcake
          </p>
          <h1 className="font-heading text-2xl font-semibold">Sign in</h1>
        </div>

        {stage === "email" && (
          <form onSubmit={sendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Send sign-in code"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Cupcake is invite-only. The email contains a sign-in code and a
              magic link — either works.
            </p>
          </form>
        )}

        {stage === "verify" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 text-sm">
              <p className="font-medium">Code sent to {email}</p>
              <p className="mt-1 text-muted-foreground">
                Enter the code from the email below, or click the link in the
                email.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Sign-in code</Label>
              <Input
                id="code"
                inputMode="numeric"
                pattern="[0-9]{6,10}"
                placeholder="••••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                maxLength={10}
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-lg tracking-[0.4em]"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={pending || code.length < 6}
            >
              {pending ? "Verifying…" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStage("email")
                setCode("")
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  )
}
