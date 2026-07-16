import { redirect } from "next/navigation"

import { QolHistory, type QolRow } from "@/components/app/forum/qol-history"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const ALLOWED_ROLES = ["moderator", "assistant_moderator", "technology"]

export default async function QolHistoryPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  // Gate: moderator / assistant moderator / technology only. (The RPC also
  // enforces this server-side, so it's defence in depth.)
  const { data: roles } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const allowed = (roles ?? []).some((r) => ALLOWED_ROLES.includes(r.role_type))
  if (!allowed) redirect("/forum/parking-lot")

  const { data, error } = await supabase.rpc("forum_qol_history")
  const rows = (error ? [] : (data ?? [])) as QolRow[]

  const nowMs = new Date().getTime()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">QOL History</h1>
        <p className="text-sm text-muted-foreground">
          Everyone&apos;s Quality-of-Life numbers over time. Visible to
          moderator, assistant moderator, and technology roles only. Scroll
          sideways to see more meetings.
        </p>
      </header>

      <QolHistory rows={rows} nowMs={nowMs} />
    </div>
  )
}
