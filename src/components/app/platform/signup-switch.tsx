"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { setSignupEnabled } from "@/lib/platform/actions"

export function SignupSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    if (
      next &&
      !window.confirm(
        "Open public sign-up? Anyone with an email address will be able to create a forum. Make sure the auth email sender (SMTP) is configured first."
      )
    ) {
      return
    }
    startTransition(async () => {
      try {
        const res = await setSignupEnabled(next)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(next ? "Sign-up is open." : "Sign-up is closed.")
        router.refresh()
      } catch {
        toast.error("Couldn't save. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="flex items-start gap-3">
      <Switch id="signup-enabled" checked={enabled} disabled={pending} onCheckedChange={(v) => toggle(!!v)} />
      <div>
        <Label htmlFor="signup-enabled" className="text-sm">
          {enabled ? "Open — anyone can create a forum" : "Closed — new forums only by your say-so"}
        </Label>
        <p className="text-xs text-muted-foreground">
          Controls /signup, the &quot;start here&quot; link on the login page, and the
          create-forum function itself. Invite links work either way.
        </p>
      </div>
    </div>
  )
}
