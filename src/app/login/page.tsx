"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
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
}

function LoginPageInner() {
  const params = useSearchParams()
  const errorParam = params.get("error")

  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (errorParam) {
      toast.error(ERROR_MESSAGES[errorParam] ?? errorParam)
    }
  }, [errorParam])

  async function onSubmit(e: React.FormEvent) {
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
    setSent(true)
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

        {sent ? (
          <div className="rounded-lg border bg-muted/50 p-4 text-sm">
            <p className="font-medium">Check your inbox.</p>
            <p className="mt-1 text-muted-foreground">
              We sent a magic-link to <span className="font-medium">{email}</span>.
              The link works once and expires after an hour.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
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
              {pending ? "Sending…" : "Send magic link"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Cupcake is invite-only. If you weren&apos;t invited, sign-in will
              not complete.
            </p>
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
