import { RoleSelector } from "@/components/app/admin/role-selector"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminRolesPage() {
  const me = await requireCurrentMember()
  const year = new Date().getFullYear()
  const supabase = await createClient()

  const [{ data: members }, { data: roles }] = await Promise.all([
    supabase
      .from("members")
      .select("id, name")
      .eq("forum_id", me.forum_id)
      .order("name"),
    supabase
      .from("roles")
      .select("role_type, member_id, year")
      .eq("forum_id", me.forum_id)
      .eq("year", year),
  ])

  const memberList = members ?? []
  const holderOf = (rt: string): string | null =>
    (roles ?? []).find((r) => r.role_type === rt)?.member_id ?? null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-semibold">
          Annual roles · {year}
        </h2>
        <p className="text-sm text-muted-foreground">
          One member per role per year.
        </p>
      </div>

      <div className="space-y-3">
        <RoleSelector
          roleType="moderator"
          label="Moderator"
          description="Runs the meeting, owns the agenda."
          year={year}
          members={memberList}
          currentMemberId={holderOf("moderator")}
        />
        <RoleSelector
          roleType="assistant_moderator"
          label="Assistant Moderator"
          description="Backup moderator if the active one drops."
          year={year}
          members={memberList}
          currentMemberId={holderOf("assistant_moderator")}
        />
        <RoleSelector
          roleType="czar"
          label="Parking Lot Czar"
          description="Schedules topics; can submit on behalf of members."
          year={year}
          members={memberList}
          currentMemberId={holderOf("czar")}
        />
      </div>
    </div>
  )
}
