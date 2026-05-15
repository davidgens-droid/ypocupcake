import Link from "next/link"
import { format, parseISO } from "date-fns"
import { PlusCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  CategoryBadge,
  StatusBadge,
  UrgencyDot,
} from "@/components/app/parking-lot/status-pill"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const STATUS_TABS = [
  { key: "parked", label: "Parked" },
  { key: "scheduled", label: "Scheduled" },
  { key: "presented", label: "Presented" },
  { key: "archived", label: "Archived" },
] as const

type SearchParams = Promise<{ status?: string }>

export default async function ParkingLotPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireCurrentMember()
  const { status: statusParam } = await searchParams
  const status = STATUS_TABS.find((t) => t.key === statusParam)?.key ?? "parked"

  const supabase = await createClient()
  const [
    { data: items },
    { data: formats },
    { data: members },
    { data: counts },
  ] = await Promise.all([
    supabase
      .from("parking_lot_items")
      .select(
        "id, topic, context, urgency, tool_category, exploration_format, status, submitter_member_id, added_by_member_id, created_at, scheduled_meeting_id"
      )
      .eq("status", status)
      .order("created_at", { ascending: false }),
    supabase
      .from("exploration_formats")
      .select("code, display_name, default_minutes"),
    supabase.from("members").select("id, name"),
    supabase
      .from("parking_lot_items")
      .select("status", { count: "exact", head: false }),
  ])

  const formatLabel = new Map(
    (formats ?? []).map((f) => [
      f.code,
      `${f.display_name} · ${f.default_minutes}m`,
    ])
  )
  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

  const statusCount = (counts ?? []).reduce<Record<string, number>>(
    (acc, row: { status: string }) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1
      return acc
    },
    {}
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Parking Lot</h1>
          <p className="text-sm text-muted-foreground">
            Topics the group has agreed to explore.
          </p>
        </div>
        <Button
          size="sm"
          render={<Link href="/forum/parking-lot/new" />}
        >
          <PlusCircle className="size-4" /> New item
        </Button>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1 text-sm">
        {STATUS_TABS.map((t) => {
          const active = t.key === status
          return (
            <Link
              key={t.key}
              href={`/forum/parking-lot?status=${t.key}`}
              className={
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-center transition-colors " +
                (active
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
              {statusCount[t.key] ? (
                <span className="text-xs text-muted-foreground">
                  {statusCount[t.key]}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>

      {/* Items */}
      {(items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing in {STATUS_TABS.find((t) => t.key === status)?.label}.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items!.map((item) => {
            const submitter = memberName.get(item.submitter_member_id) ?? "—"
            const addedByOther =
              item.added_by_member_id !== item.submitter_member_id
            const fmt = formatLabel.get(item.exploration_format) ?? item.exploration_format
            return (
              <li key={item.id}>
                <Link
                  href={`/forum/parking-lot/${item.id}`}
                  className="block rounded-lg border bg-card transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <UrgencyDot value={item.urgency} />
                      <CategoryBadge value={item.tool_category} />
                      <span className="text-xs text-muted-foreground">{fmt}</span>
                      <span className="ml-auto">
                        <StatusBadge value={item.status} />
                      </span>
                    </div>
                    <p className="text-sm font-medium">{item.topic}</p>
                    {item.context && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.context}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Submitted by {submitter}
                      {addedByOther &&
                        ` (added by ${memberName.get(item.added_by_member_id) ?? "another member"})`}
                      {" · "}
                      {format(parseISO(item.created_at), "MMM d")}
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
