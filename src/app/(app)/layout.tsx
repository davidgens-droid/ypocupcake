import { AppHeader } from "@/components/app/nav/app-header"
import { AppSidebar, AppTabBar } from "@/components/app/nav/app-nav"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { isPlatformAdmin } from "@/lib/platform/access"

/**
 * The signed-in app shell. requireCurrentMember() sends anyone who isn't an
 * active member of an active forum to the page that explains why (/removed,
 * /suspended, /onboarding, or /login); every page under here calls it again
 * for its own data, which is free thanks to the per-request cache.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await requireCurrentMember()
  const showPlatform = await isPlatformAdmin()

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <AppSidebar forumName={me.forum.name} showPlatform={showPlatform} />
      <div className="flex min-h-screen flex-1 flex-col">
        <AppHeader />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        <AppTabBar showPlatform={showPlatform} />
      </div>
    </div>
  )
}
