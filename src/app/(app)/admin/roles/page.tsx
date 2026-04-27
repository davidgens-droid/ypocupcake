import { RoleSelector } from "@/components/app/admin/role-selector"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const ROLES: Array<{
  key:
    | "moderator"
    | "assistant_moderator"
    | "czar"
    | "secretary"
    | "treasurer"
    | "technology"
    | "retreat_planner"
    | "timekeeper"
    | "norm_observer"
    | "social_coordinator"
  label: string
  description: string
}> = [
  {
    key: "moderator",
    label: "Moderator",
    description: "Runs meetings, owns the agenda.",
  },
  {
    key: "assistant_moderator",
    label: "Assistant Moderator",
    description: "Backup moderator if the active one drops.",
  },
  {
    key: "czar",
    label: "Parking Lot Czar",
    description: "Schedules topics; can submit on behalf of members.",
  },
  {
    key: "secretary",
    label: "Secretary",
    description: "Keeps records, takeaways, and meeting notes.",
  },
  {
    key: "treasurer",
    label: "Treasurer",
    description: "Manages dues, expenses, and reimbursements.",
  },
  {
    key: "technology",
    label: "Technology",
    description: "Owns the forum's tools and tech (incl. this app).",
  },
  {
    key: "retreat_planner",
    label: "Retreat Planner",
    description: "Plans the annual retreat.",
  },
  {
    key: "timekeeper",
    label: "Timekeeper",
    description: "Keeps the meeting on schedule alongside the moderator.",
  },
  {
    key: "norm_observer",
    label: "Forum Norm Observer",
    description: "Watches for adherence to the Forum Norms.",
  },
  {
    key: "social_coordinator",
    label: "Social Coordinator",
    description: "Coordinates summer get-togethers, Christmas dinner, etc.",
  },
]

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
          One member per role per year. From the signed Cupcake Forum Norms.
        </p>
      </div>

      <div className="space-y-3">
        {ROLES.map((r) => (
          <RoleSelector
            key={r.key}
            roleType={r.key}
            label={r.label}
            description={r.description}
            year={year}
            members={memberList}
            currentMemberId={holderOf(r.key)}
          />
        ))}
      </div>
    </div>
  )
}
