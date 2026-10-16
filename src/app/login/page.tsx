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
  missing_code: "That sign-in attempt was malformed. Request a fresh code.",
  no_user: "Sign-in completed but no user was returned. Try again.",
  otp_expired:
    "That code expired or was already used. Request a fresh one.",
  access_denied: "Sign-in was declined. Request a fresh code and try again.",
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
    // Code-only sign-in: no emailRedirectTo, so we rely on the 6-digit code in
    // the email (corporate mail scanners pre-click magic links and consume them;
    // they don't type codes). The email template must present {{ .Token }}.
    const { error } = await supabase.auth.signInWithOtp({ email })
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
    // so we can surface a helpful error before redirecting. my_forum_status()
    // answers for ANY membership state (a removed member, or a member of a
    // suspended forum, can't read their own members row under RLS, but they
    // still belong somewhere and get the page that explains why).
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setPending(false)
      toast.error("Sign-in returned no user.")
      return
    }
    const { data: status } = await supabase.rpc("my_forum_status").maybeSingle()
    if (!status) {
      await supabase.auth.signOut()
      setPending(false)
      toast.error(ERROR_MESSAGES.not_invited)
      return
    }
    const row = status as { forum_status: string; member_status: string }
    const destination =
      row.member_status === "removed"
        ? "/removed"
        : row.forum_status !== "active"
          ? "/suspended"
          : "/dashboard"

    router.push(destination)
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
              Cupcake is invite-only. We&apos;ll email you a 6-digit sign-in
              code.
            </p>
          </form>
        )}

        {stage === "verify" && (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 text-sm">
              <p className="font-medium">Code sent to {email}</p>
              <p className="mt-1 text-muted-foreground">
                Enter the 6-digit code from the email below. (Tip: type it in —
                don&apos;t forward the email.)
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
