import { format, parseISO } from "date-fns"
import { redirect } from "next/navigation"

import { CharterForm } from "@/components/app/admin/charter-form"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminCharterPage() {
  const me = await requireCurrentMember()
  if (!me.is_admin) redirect("/admin/meetings")
  const supabase = await createClient()

  const { data: forum } = await supabase
    .from("forums")
    .select("settings")
    .eq("id", me.forum_id)
    .single()

  const settings = (forum?.settings ?? {}) as {
    charter?: string
    charter_updated_at?: string
  }
  const charter = typeof settings.charter === "string" ? settings.charter : ""

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Forum Charter</h2>
        <p className="text-sm text-muted-foreground">
          Shared values, attendance norms, confidentiality. Visible to all
          members; only admins can edit.
        </p>
        {settings.charter_updated_at && (
          <p className="text-xs text-muted-foreground">
            Last updated{" "}
            {format(parseISO(settings.charter_updated_at), "MMM d, yyyy")}
          </p>
        )}
      </div>

      <CharterForm initial={charter} />

      {charter && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <p className="whitespace-pre-line text-sm">{charter}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
