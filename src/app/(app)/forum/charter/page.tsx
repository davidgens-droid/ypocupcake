import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ExternalLink, FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { CHARTER_SIGNED_URL_TTL, formatBytes, parseCharterSettings } from "@/lib/forums/charter"
import { createClient } from "@/lib/supabase/server"

/** The forum's charter / norms, as the members read it. */
export default async function ForumCharterPage() {
  const me = await requireCurrentMember()
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
  const empty = !charter.document && !charter.text

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Charter</h1>
        <p className="text-sm text-muted-foreground">
          {me.forum.name}&apos;s shared values, attendance norms and confidentiality.
          {charter.updatedAt ? ` Last updated ${format(parseISO(charter.updatedAt), "MMM d, yyyy")}.` : ""}
        </p>
      </header>

      {charter.document && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
            <FileText className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={charter.document.name}>
                {charter.document.name}
              </p>
              <p className="text-xs text-muted-foreground">{formatBytes(charter.document.size)}</p>
            </div>
            {signedUrl ? (
              <Button className="gap-1" render={<a href={signedUrl} target="_blank" rel="noopener noreferrer" />}>
                <ExternalLink className="size-4" /> Open document
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Couldn&apos;t prepare the link; reload to try again.</p>
            )}
          </CardContent>
        </Card>
      )}

      {charter.text && (
        <Card>
          <CardContent className="py-4">
            <p className="whitespace-pre-line text-sm">{charter.text}</p>
          </CardContent>
        </Card>
      )}

      {empty && (
        <Card>
          <CardContent className="space-y-3 py-6 text-center text-sm text-muted-foreground">
            <p>Your admin hasn&apos;t added the charter yet.</p>
            {me.is_admin && (
              <Button size="sm" variant="outline" render={<Link href="/admin/charter" />}>
                Add it now
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
