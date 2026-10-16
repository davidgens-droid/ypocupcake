import { signOut } from "@/app/(app)/actions"
import { Button } from "@/components/ui/button"

/**
 * Server-rendered sign-out: a plain form posting to the signOut action, so it
 * works on every page that has a session — including the /removed and
 * /suspended pages, which render outside the app shell.
 */
export function SignOutButton({
  variant = "ghost",
  size = "sm",
}: {
  variant?: "ghost" | "outline" | "default"
  size?: "sm" | "default"
}) {
  return (
    <form action={signOut}>
      <Button size={size} variant={variant} type="submit">
        Sign out
      </Button>
    </form>
  )
}
