import { ForumSubNav } from "@/components/app/nav/forum-sub-nav"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { getMyRoles, hasAny, type RoleType } from "@/lib/auth/roles"

const QOL_ROLES: RoleType[] = ["moderator", "assistant_moderator", "technology"]

export default async function ForumLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await requireCurrentMember()
  const roles = await getMyRoles(me)
  const showQolHistory = hasAny(roles, ...QOL_ROLES)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <ForumSubNav showQolHistory={showQolHistory} />
      {children}
    </div>
  )
}
