import { format, parseISO } from "date-fns"
import { redirect } from "next/navigation"

import { CharterDocumentUploader } from "@/components/app/admin/charter-document-uploader"
import { CharterForm } from "@/components/app/admin/charter-form"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { CHARTER_SIGNED_URL_TTL, parseCharterSettings } from "@/lib/forums/charter"
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
  const charter = parseCharterSettings(forum?.settings)
  const signedUrl = charter.document
    ? ((await supabase.storage.from("charters").createSignedUrl(charter.document.path, CHARTER_SIGNED_URL_TTL)).data?.signedUrl ?? null)
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-base font-semibold">Forum Charter</h2>
        <p className="text-sm text-muted-foreground">
          Shared values, attendance norms, confidentiality. Members read it
          under Forum → Charter; only admins can change it.
        </p>
        {charter.updatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {format(parseISO(charter.updatedAt), "MMM d, yyyy")}
          </p>
        )}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Upload your charter</h3>
        <p className="text-sm text-muted-foreground">
          Already have your charter or norms as a PDF or Word file? Upload it
          and members can open it straight from the app.
        </p>
        <CharterDocumentUploader forumId={me.forum_id} current={charter.document} signedUrl={signedUrl} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{charter.document ? "Or write it as text" : "Or write it as text instead"}</h3>
        <p className="text-sm text-muted-foreground">
          Members see the text alongside the document if you add both.
        </p>
        <CharterForm initial={charter.text} />
      </section>

      {charter.text && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <p className="whitespace-pre-line text-sm">{charter.text}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
