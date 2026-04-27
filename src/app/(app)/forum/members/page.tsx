import { format, parseISO } from "date-fns"
import { Mail, Cake } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const ROLE_LABEL: Record<string, string> = {
  moderator: "Moderator",
  assistant_moderator: "Asst. Moderator",
  czar: "Czar",
  secretary: "Secretary",
  treasurer: "Treasurer",
  technology: "Technology",
  retreat_planner: "Retreat Planner",
  timekeeper: "Timekeeper",
  norm_observer: "Norm Observer",
  social_coordinator: "Social Coordinator",
  host: "Host",
}

export default async function MembersPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const year = new Date().getFullYear()

  const [{ data: members }, { data: roles }, { data: invites }] =
    await Promise.all([
      supabase
        .from("members")
        .select(
          "id, name, email, photo_url, family, birthday, anniversary, is_admin, created_at"
        )
        .eq("forum_id", me.forum_id)
        .order("name"),
      supabase
        .from("roles")
        .select("member_id, role_type")
        .eq("forum_id", me.forum_id)
        .eq("year", year),
      supabase
        .from("member_invites")
        .select("email, name, is_admin")
        .order("name"),
    ])

  const rolesByMember = new Map<string, string[]>()
  for (const r of roles ?? []) {
    const list = rolesByMember.get(r.member_id) ?? []
    list.push(r.role_type)
    rolesByMember.set(r.member_id, list)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          {(members?.length ?? 0)} active ·{" "}
          {(invites?.length ?? 0)} awaiting first sign-in
        </p>
      </header>

      <section className="space-y-2">
        <ul className="grid gap-2 sm:grid-cols-2">
          {(members ?? []).map((m) => {
            const family = m.family as
              | { partner?: string; children?: string[] }
              | null
            const memberRoles = rolesByMember.get(m.id) ?? []
            return (
              <li key={m.id}>
                <Card>
                  <CardContent className="space-y-1.5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">
                        {m.name}
                        {m.id === me.id && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      {m.is_admin && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                          Admin
                        </span>
                      )}
                    </div>
                    {memberRoles.length > 0 && (
                      <p className="flex flex-wrap gap-1">
                        {memberRoles.map((r) => (
                          <span
                            key={r}
                            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium"
                          >
                            {ROLE_LABEL[r] ?? r}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      <Mail className="mr-1 inline size-3" />
                      {m.email}
                    </p>
                    {(m.birthday || m.anniversary) && (
                      <p className="text-xs text-muted-foreground">
                        {m.birthday && (
                          <>
                            <Cake className="mr-1 inline size-3" />
                            {format(parseISO(m.birthday), "MMM d")}
                          </>
                        )}
                        {m.birthday && m.anniversary && " · "}
                        {m.anniversary && (
                          <>💍 {format(parseISO(m.anniversary), "MMM d")}</>
                        )}
                      </p>
                    )}
                    {family &&
                      (family.partner ||
                        (family.children && family.children.length > 0)) && (
                        <p className="text-xs text-muted-foreground">
                          Family:{" "}
                          {family.partner && family.partner}
                          {family.partner &&
                            family.children &&
                            family.children.length > 0 &&
                            ", "}
                          {family.children?.join(", ")}
                        </p>
                      )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      </section>

      {(invites ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-sm font-semibold">
            Invited, not yet signed in
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {invites!.map((i) => (
              <li key={i.email}>
                <Card>
                  <CardContent className="space-y-0.5 py-3 text-sm">
                    <p className="font-medium">
                      {i.name}
                      {i.is_admin && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                          Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <Mail className="mr-1 inline size-3" />
                      {i.email}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
