"use client"

import { useTransition } from "react"

import { signOut } from "@/app/(app)/actions"
import { Button } from "@/components/ui/button"
import { clearAllCachedKeys } from "@/lib/crypto/cache"
import { forgetAllKeys } from "@/lib/crypto/session"

/**
 * Sign out. Also forgets any unlocked update keys cached on this device
 * (they are what make encrypted updates readable here), then runs the
 * server-side sign-out, which redirects to /login.
 */
export function SignOutButton({
  variant = "ghost",
  size = "sm",
}: {
  variant?: "ghost" | "outline" | "default"
  size?: "sm" | "default"
}) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size={size}
      variant={variant}
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await clearAllCachedKeys()
          forgetAllKeys()
          await signOut()
        })
      }
    >
      Sign out
    </Button>
  )
}
