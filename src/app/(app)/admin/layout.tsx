import { redirect } from "next/navigation"

import { AdminSubNav } from "@/components/app/nav/admin-sub-nav"
import { requireCurrentMember } from "@/lib/auth/current-member"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await requireCurrentMember()
  if (!me.is_admin) redirect("/dashboard")

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Forum Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage Cupcake&apos;s members, roles, calendar, and charter.
        </p>
      </header>
      <AdminSubNav />
      {children}
    </div>
  )
}
