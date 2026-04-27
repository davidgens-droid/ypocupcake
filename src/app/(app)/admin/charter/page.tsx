import { format, parseISO } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveCharter } from "@/lib/admin/actions"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

export default async function AdminCharterPage() {
  const me = await requireCurrentMember()
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
  const charter = settings.charter ?? ""

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

      <form action={saveCharter} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="charter">Charter text</Label>
          <Textarea
            id="charter"
            name="charter"
            rows={20}
            defaultValue={charter}
            placeholder={`Our purpose\n— Why this forum exists\n\nConfidentiality\n— What stays in forum\n\nAttendance\n— Expectations\n\n…`}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Plain text. Line breaks are preserved when displayed to members.
          </p>
        </div>
        <Button type="submit">Save charter</Button>
      </form>

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
