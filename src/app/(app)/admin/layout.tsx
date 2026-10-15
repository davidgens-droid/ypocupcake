import { redirect } from "next/navigation"

import { AdminSubNav } from "@/components/app/nav/admin-sub-nav"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { canRunMeetings, getMyRoles } from "@/lib/auth/roles"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await requireCurrentMember()

  // Determine which entry points are visible to this user.
  // Admin = full access. Moderator/Asst Mod = Calendar (meetings) only.
  let isMeetingManager = me.is_admin
  if (!isMeetingManager) {
    const roles = await getMyRoles(me)
    isMeetingManager = canRunMeetings(me, roles)
  }

  if (!me.is_admin && !isMeetingManager) {
    redirect("/dashboard")
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-semibold">
          {me.is_admin ? "Forum Admin" : "Forum Settings"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {me.is_admin
            ? "Manage Cupcake's members, roles, calendar, and charter."
            : "Manage the meeting calendar."}
        </p>
      </header>
      <AdminSubNav isAdmin={me.is_admin} />
      {children}
    </div>
  )
}
