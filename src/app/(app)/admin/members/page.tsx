import Link from "next/link"
import { redirect } from "next/navigation"
import { format, parseISO } from "date-fns"
import { Link2, Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MemberStatusButton } from "@/components/app/admin/member-status-button"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminMembersPage() {
  const me = await requireCurrentMember()
  if (!me.is_admin) redirect("/admin/meetings")
  const supabase = await createClient()

  const { data: allMembers } = await supabase
    .from("members")
    .select("id, name, email, birthday, anniversary, is_admin, status, created_at")
    .eq("forum_id", me.forum_id)
    .order("name")

  const members = (allMembers ?? []).filter((m) => m.status !== "removed")
  const removed = (allMembers ?? []).filter((m) => m.status === "removed")

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">
            Members ({members.length})
          </h2>
          <Button size="sm" variant="outline" className="gap-1" render={<Link href="/admin/invite" />}>
            <Link2 className="size-4" /> Invite link
          </Button>
        </div>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id}>
              <Card>
                <CardContent className="flex items-start justify-between gap-2 py-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {m.name}
                      {m.is_admin && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                          Admin
                        </span>
                      )}
                      {m.id === me.id && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <Mail className="mr-1 inline size-3" />
                      {m.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Joined {format(parseISO(m.created_at), "MMM yyyy")}
                      {m.birthday && (
                        <> · 🎂 {format(parseISO(m.birthday), "MMM d")}</>
                      )}
                    </p>
                  </div>
                  {m.id !== me.id && (
                    <MemberStatusButton memberId={m.id} name={m.name} mode="remove" />
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {removed.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-semibold">
            Removed ({removed.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            No longer have access. Their updates and history are kept and stay
            private to them. Restore to let them back in.
          </p>
          <ul className="space-y-2">
            {removed.map((m) => (
              <li key={m.id}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-2 py-3 text-sm">
                    <div className="space-y-0.5">
                      <p className="font-medium text-muted-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Mail className="mr-1 inline size-3" />
                        {m.email}
                      </p>
                    </div>
                    <MemberStatusButton memberId={m.id} name={m.name} mode="restore" />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Adding members</h2>
        <Card>
          <CardContent className="space-y-3 py-4 text-sm">
            <p>
              Share your forum&apos;s invite link. Whoever opens it signs in with
              their own email and joins as a member; you can make them an admin
              afterwards, and revoke the link whenever you like.
            </p>
            <Button size="sm" className="gap-1" render={<Link href="/admin/invite" />}>
              <Link2 className="size-4" /> Manage the invite link
            </Button>
            <p className="text-xs text-muted-foreground">
              Admins can manage members, roles, calendar, charter, and settings.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
