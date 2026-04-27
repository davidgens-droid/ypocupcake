import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft } from "lucide-react"
import { notFound } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CommitmentStatusForm } from "@/components/app/commitments/status-form"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ id: string }>

export default async function CommitmentDetailPage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  const { data: c } = await supabase
    .from("commitments")
    .select("id, member_id, text, due_date, status, notes, created_at, meeting_id")
    .eq("id", id)
    .maybeSingle()

  if (!c) notFound()

  const { data: members } = await supabase.from("members").select("id, name")
  const memberName =
    (members ?? []).find((m) => m.id === c.member_id)?.name ?? "—"

  const isMine = c.member_id === me.id

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button
        size="sm"
        variant="ghost"
        render={<Link href="/forum/commitments" />}
      >
        <ChevronLeft className="size-4" /> Commitments
      </Button>

      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">{c.text}</h1>
        <p className="text-sm text-muted-foreground">
          {memberName} · created {format(parseISO(c.created_at), "MMM d, yyyy")}
          {c.due_date && <> · due {format(parseISO(c.due_date), "MMM d, yyyy")}</>}
        </p>
      </div>

      {c.notes && (
        <Card>
          <CardContent className="py-3 text-sm whitespace-pre-line">
            {c.notes}
          </CardContent>
        </Card>
      )}

      {isMine ? (
        <CommitmentStatusForm
          id={c.id}
          initialStatus={c.status as "open" | "done" | "carried_over" | "dropped"}
          initialNotes={c.notes ?? ""}
        />
      ) : (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            Only {memberName} can update this commitment&apos;s status.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
