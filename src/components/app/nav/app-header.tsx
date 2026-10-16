import { NotificationsBell } from "@/components/app/nav/notifications-bell"
import { SignOutButton } from "@/components/app/nav/sign-out-button"
import { getCurrentMember } from "@/lib/auth/current-member"

export async function AppHeader() {
  const me = await getCurrentMember()
  if (!me) return null

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur md:px-8">
      <p className="truncate font-heading text-sm font-semibold md:hidden">{me.forum.name}</p>
      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell memberId={me.id} />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {me.name}
        </span>
        <SignOutButton />
      </div>
    </header>
  )
}
