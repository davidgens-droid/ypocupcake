import { format, parseISO } from "date-fns"
import { Mail, Trash2, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { createInvite, deleteInvite } from "@/lib/admin/actions"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminMembersPage() {
  const me = await requireCurrentMember()
  if (!me.is_admin) {
    const { redirect } = await import("next/navigation")
    redirect("/admin/meetings")
  }
  const supabase = await createClient()

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, email, birthday, anniversary, is_admin, created_at")
      .order("name"),
    supabase
      .from("member_invites")
      .select("email, name, is_admin, created_at")
      .order("created_at", { ascending: false }),
  ])

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">
            Members ({members?.length ?? 0})
          </h2>
        </div>
        <ul className="space-y-2">
          {(members ?? []).map((m) => (
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
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">
          Pending invites ({invites?.length ?? 0})
        </h2>
        {(invites ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pending invites. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {invites!.map((i) => (
              <li key={i.email}>
                <Card>
                  <CardContent className="flex items-center justify-between gap-2 py-3 text-sm">
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        {i.name}
                        {i.is_admin && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                            Admin
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Mail className="mr-1 inline size-3" /> {i.email}
                      </p>
                    </div>
                    <form action={deleteInvite}>
                      <input type="hidden" name="email" value={i.email} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        title="Revoke invite"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Invite a member</h2>
        <Card>
          <CardContent className="py-4">
            <form action={createInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required maxLength={120} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
                <Switch id="is_admin" name="is_admin" />
                <div>
                  <Label htmlFor="is_admin" className="text-sm">
                    Admin
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Admins can manage members, roles, calendar, and charter.
                  </p>
                </div>
              </div>
              <Button type="submit">
                <UserPlus className="size-4" /> Add invite
              </Button>
              <p className="text-xs text-muted-foreground">
                Invitee can sign in with this email. The invite is consumed on
                their first sign-in.
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
