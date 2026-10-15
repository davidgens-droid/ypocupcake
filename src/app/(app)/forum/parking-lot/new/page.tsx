import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NewItemForm } from "@/components/app/parking-lot/new-item-form"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { getMyRoles, hasAny, isParkingLotPrivileged } from "@/lib/auth/roles"
import { createClient } from "@/lib/supabase/server"
import type { ExplorationFormat } from "@/lib/types/domain"

type SearchParams = Promise<{ topic?: string }>

export default async function NewParkingLotItemPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const me = await requireCurrentMember()
  const supabase = await createClient()
  const { topic: prefilledTopic } = await searchParams

  const [{ data: formatsRaw }, roles, { data: membersRaw }] =
    await Promise.all([
      supabase
        .from("exploration_formats")
        .select(
          "code, category, display_name, default_minutes, short_description, moderator_instructions, source_attribution"
        ),
      getMyRoles(me),
      supabase.from("members").select("id, name").eq("status", "active").order("name"),
    ])

  const isCzar = hasAny(roles, "czar")
  const isModerator = hasAny(roles, "moderator", "assistant_moderator")
  const canSubmitOnBehalf = isParkingLotPrivileged(me, roles)

  const onBehalfLabel = isCzar
    ? "Czar"
    : isModerator
      ? "Moderator"
      : me.is_admin
        ? "Admin"
        : null

  const formats = (formatsRaw ?? []) as ExplorationFormat[]
  const members = (membersRaw ?? []) as { id: string; name: string }[]

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/forum/parking-lot" />}
        >
          <ChevronLeft className="size-4" /> Parking Lot
        </Button>
      </div>
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">
          New parking lot item
        </h1>
        <p className="text-sm text-muted-foreground">
          Submitting as {me.name}
          {canSubmitOnBehalf &&
            ` — as ${onBehalfLabel}, you can also submit on behalf of another member.`}
        </p>
        <NewItemForm
          formats={formats}
          members={canSubmitOnBehalf ? members : undefined}
          canSubmitOnBehalf={canSubmitOnBehalf}
          onBehalfLabel={onBehalfLabel ?? "you"}
          defaultSubmitterId={canSubmitOnBehalf ? me.id : undefined}
          defaultTopic={prefilledTopic ?? ""}
        />
      </div>
    </div>
  )
}
