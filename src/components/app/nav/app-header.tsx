import { signOut } from "@/app/(app)/actions"
import { Button } from "@/components/ui/button"
import { getCurrentMember } from "@/lib/auth/current-member"

export async function AppHeader() {
  const me = await getCurrentMember()
  if (!me) return null

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur md:px-8">
      <p className="font-heading text-sm font-semibold md:hidden">Cupcake</p>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {me.name}
        </span>
        <form action={signOut}>
          <Button size="sm" variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  )
}
