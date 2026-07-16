import { ForumSubNav } from "@/components/app/nav/forum-sub-nav"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const QOL_ROLES = ["moderator", "assistant_moderator", "technology"]

export default async function ForumLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { data: roles } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const showQolHistory = (roles ?? []).some((r) =>
    QOL_ROLES.includes(r.role_type)
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <ForumSubNav showQolHistory={showQolHistory} />
      {children}
    </div>
  )
}
