import { notFound } from "next/navigation"

import { ForumStatusButton } from "@/components/app/platform/forum-status-button"
import { SignupSwitch } from "@/components/app/platform/signup-switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { formatMeeting } from "@/lib/dates"
import { isSignupEnabled } from "@/lib/forums/signup"
import { isPlatformAdmin, type PlatformForumRow } from "@/lib/platform/access"
import { createClient } from "@/lib/supabase/server"

/**
 * Platform operators only (404 for everyone else, so the page's existence
 * isn't advertised). Every number here comes from platform_forum_stats(),
 * a SECURITY DEFINER that returns forum-level aggregates and nothing from
 * inside a forum.
 */
export default async function PlatformPage() {
  const me = await requireCurrentMember()
  if (!(await isPlatformAdmin())) notFound()

  const supabase = await createClient()
  const [{ data: rows, error }, signupEnabled] = await Promise.all([
    supabase.rpc("platform_forum_stats"),
    isSignupEnabled(),
  ])
  if (error) throw new Error("Couldn't load the forum list.")
  const forums = (rows ?? []) as PlatformForumRow[]
  const tz = me.forum.timezone
  const date = (iso: string | null, fmt = "MMM d, yyyy") => (iso ? formatMeeting(iso, fmt, tz) : "—")

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Platform</h1>
        <p className="text-sm text-muted-foreground">
          Every forum on Cupcake. Counts and dates only — nothing from inside a
          forum is readable here. Times in {tz.replace(/_/g, " ")}.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Public sign-up</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupSwitch enabled={signupEnabled} />
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Forums ({forums.length})</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Forum</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Founder</th>
                <th className="px-3 py-2 text-right">Members</th>
                <th className="px-3 py-2 text-right">Meetings</th>
                <th className="px-3 py-2">Next meeting</th>
                <th className="px-3 py-2 text-right">AI calls (30d)</th>
                <th className="px-3 py-2">Last activity</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {forums.map((f) => (
                <tr key={f.forum_id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground">{f.timezone.replace(/_/g, " ")}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        f.status === "active"
                          ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-900"
                          : "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900"
                      }
                    >
                      {f.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <p>{f.founder_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{f.founder_email ?? ""}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {f.member_count}
                    <span className="text-xs text-muted-foreground"> ({f.admin_count} admin{f.admin_count === 1 ? "" : "s"})</span>
                    <p className="text-xs text-muted-foreground" title="Members who have set up end-to-end protection for their updates">
                      {f.protected_count} of {f.member_count} protected
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.meeting_count}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(f.next_meeting_at, "MMM d, yyyy · h:mm a")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.ai_calls_30d}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(f.last_activity)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{date(f.created_at)}</td>
                  <td className="px-3 py-2">
                    <ForumStatusButton
                      forumId={f.forum_id}
                      name={f.name}
                      status={f.status}
                      isOwn={f.forum_id === me.forum_id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
