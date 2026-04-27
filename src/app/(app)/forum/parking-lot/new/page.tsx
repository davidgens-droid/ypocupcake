import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NewItemForm } from "@/components/app/parking-lot/new-item-form"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import type { ExplorationFormat } from "@/lib/types/domain"

export default async function NewParkingLotItemPage() {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  const [{ data: formatsRaw }, { data: rolesRaw }, { data: membersRaw }] =
    await Promise.all([
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

  const isCzar = (rolesRaw ?? []).some((r) => r.role_type === "czar")
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
        <h1 className="font-heading text-2xl font-semibold">New parking lot item</h1>
        <p className="text-sm text-muted-foreground">
          Submitting as {me.name}
          {isCzar &&
            " — as Czar, you can submit on behalf of another member."}
        </p>
        <NewItemForm
          formats={formats}
          members={isCzar ? members : undefined}
          isCzar={isCzar}
          defaultSubmitterId={isCzar ? me.id : undefined}
        />
      </div>
    </div>
  )
}
