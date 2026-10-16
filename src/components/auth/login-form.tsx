"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

const ERROR_MESSAGES: Record<string, string> = {
  not_invited: "That email doesn't belong to a forum yet. Ask your forum's admin for an invite link.",
  missing_code: "That sign-in attempt was malformed. Request a fresh code.",
  no_user: "Sign-in completed but no user was returned. Try again.",
  otp_expired: "That code expired or was already used. Request a fresh one.",
  access_denied: "Sign-in was declined. Request a fresh code and try again.",
}

export type LoginMode = "login" | "signup" | "join"

const COPY: Record<LoginMode, { title: string; blurb: string; button: string }> = {
  login: {
    title: "Sign in",
    blurb: "We'll email you a 6-digit sign-in code.",
    button: "Send sign-in code",
  },
  signup: {
    title: "Set up a new forum",
    blurb: "Enter your email and we'll send a 6-digit code. You'll name your forum on the next screen.",
    button: "Send my code",
  },
  join: {
    title: "Sign in to accept the invite",
    blurb: "We'll email you a 6-digit code. New here? That's fine — this creates your account.",
    button: "Send my code",
  },
}

/** Only same-origin, path-style destinations ("/join/abc"): never "//evil", "@evil", "\\evil". */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\s@]/.test(raw)) return null
  return raw
}

type Props = {
  mode: LoginMode
  /** Where to go after sign-in when the account has no membership yet. */
  next?: string
  /** Shows the "setting up a new forum?" link on the plain login form. */
  signupEnabled?: boolean
}

export function LoginForm({ mode, next, signupEnabled = false }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const errorParam = params.get("error")
  const nextParam = safeNext(next ?? params.get("next"))

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

    // Where next depends on the account's membership state. my_forum_status()
    // answers for ANY state (a removed member can't read their own members
    // row under RLS, but they still belong somewhere and get the page that
    // explains why). No row at all = a brand-new account → onboarding, or
    // straight to the invite they came from.
    const { data: status } = await supabase.rpc("my_forum_status").maybeSingle()
    let destination: string
    if (status) {
      const row = status as { forum_status: string; member_status: string }
      destination =
        row.member_status === "removed"
          ? "/removed"
          : row.forum_status !== "active"
            ? "/suspended"
            : (nextParam ?? "/dashboard")
    } else {
      destination = nextParam ?? (mode === "signup" ? "/onboarding?intent=create" : "/onboarding")
    }

    router.push(destination)
    router.refresh()
  }

  const copy = COPY[mode]

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
        <h1 className="font-heading text-2xl font-semibold">{copy.title}</h1>
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
            {pending ? "Sending…" : copy.button}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{copy.blurb}</p>
          {mode === "login" && signupEnabled && (
            <p className="text-center text-xs text-muted-foreground">
              Setting up a new forum?{" "}
              <Link href="/signup" className="underline underline-offset-2 hover:text-foreground">
                Start here
              </Link>
            </p>
          )}
          {mode === "signup" && (
            <p className="text-center text-xs text-muted-foreground">
              Already in a forum?{" "}
              <Link href="/login" className="underline underline-offset-2 hover:text-foreground">
                Sign in
              </Link>
            </p>
          )}
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
          <Button type="submit" className="w-full" disabled={pending || code.length < 6}>
            {pending ? "Verifying…" : mode === "login" ? "Sign in" : "Continue"}
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
  )
}
