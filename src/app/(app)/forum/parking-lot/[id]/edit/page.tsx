import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { EditItemForm } from "@/components/app/parking-lot/edit-item-form"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { ExplorationFormat } from "@/lib/types/domain"

type Params = Promise<{ id: string }>

export default async function EditParkingLotItemPage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { id } = await params
  const supabase = await createClient()

  const [{ data: item }, { data: formatsRaw }, { data: rolesRaw }, { data: membersRaw }] =
    await Promise.all([
      supabase
        .from("parking_lot_items")
        .select(
          "id, topic, context, urgency, tool_category, exploration_format, submitter_member_id, status"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("exploration_formats")
        .select(
          "code, category, display_name, default_minutes, short_description, moderator_instructions, source_attribution"
        ),
      supabase
        .from("roles")
        .select("role_type")
        .eq("member_id", me.id)
        .eq("year", new Date().getFullYear()),
      supabase.from("members").select("id, name").order("name"),
    ])

  if (!item) notFound()

  const myRoles = (rolesRaw ?? []).map((r) => r.role_type)
  const isPrivileged =
    me.is_admin ||
    myRoles.includes("moderator") ||
    myRoles.includes("assistant_moderator") ||
    myRoles.includes("czar")

  const isSubmitterAndEditable =
    item.submitter_member_id === me.id && item.status === "parked"

  if (!isPrivileged && !isSubmitterAndEditable) {
    // Not allowed to edit — bounce back to the detail view.
    redirect(`/forum/parking-lot/${id}`)
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href={`/forum/parking-lot/${id}`} />}
        >
          <ChevronLeft className="size-4" /> Back to item
        </Button>
      </div>
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Edit parking lot item</h1>
        <EditItemForm
          item={{
            id: item.id,
            topic: item.topic,
            context: item.context,
            urgency: item.urgency,
            tool_category: item.tool_category,
            exploration_format: item.exploration_format,
            submitter_member_id: item.submitter_member_id,
          }}
          formats={(formatsRaw ?? []) as ExplorationFormat[]}
          members={(membersRaw ?? []) as { id: string; name: string }[]}
          canReassignSubmitter={isPrivileged}
        />
      </div>
    </div>
  )
}
