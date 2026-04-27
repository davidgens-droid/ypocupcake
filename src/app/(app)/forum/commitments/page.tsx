import Link from "next/link"
import { format, parseISO } from "date-fns"
import { AlertTriangle, CheckCircle2, Circle, RotateCcw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "mine", label: "Mine" },
  { key: "forum", label: "Forum" },
  { key: "done", label: "Done" },
] as const

type SearchParams = Promise<{ tab?: string }>

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const me = await requireCurrentMember()
  const { tab: tabParam } = await searchParams
  const tab = TABS.find((t) => t.key === tabParam)?.key ?? "mine"

  const supabase = await createClient()

  const baseQuery = supabase
    .from("commitments")
    .select("id, member_id, text, due_date, status, notes, created_at")
    .order("due_date", { ascending: true, nullsFirst: false })

  const { data: items } =
    tab === "mine"
      ? await baseQuery.eq("member_id", me.id).neq("status", "done").neq("status", "dropped")
      : tab === "done"
        ? await baseQuery.in("status", ["done", "dropped"])
        : await baseQuery.in("status", ["open", "carried_over"])

  const { data: members } = await supabase.from("members").select("id, name")
  const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

  const today = new Date()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Commitments</h1>
          <p className="text-sm text-muted-foreground">
            Forum-wide accountability. Surfaces in next meeting&apos;s check-in.
          </p>
        </div>
      </header>

      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1 text-sm">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <Link
              key={t.key}
              href={`/forum/commitments?tab=${t.key}`}
              className={cn(
                "flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-center transition-colors",
                active
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {(items ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tab === "mine"
              ? "You have no open commitments. They appear here after meetings."
              : tab === "done"
                ? "No completed commitments yet."
                : "No open forum commitments."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items!.map((c) => {
            const overdue =
              c.due_date && c.status === "open" && parseISO(c.due_date) < today
            const memberLabel = memberName.get(c.member_id) ?? "—"
            const isMine = c.member_id === me.id

            return (
              <li key={c.id}>
                <Link
                  href={`/forum/commitments/${c.id}`}
                  className="block rounded-lg border bg-card transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start gap-3 p-3">
                    <StatusIcon status={c.status} />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm">{c.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {tab !== "mine" && <>{memberLabel} · </>}
                        {c.due_date && (
                          <>
                            {overdue ? (
                              <span className="text-destructive">
                                <AlertTriangle className="mr-1 inline size-3" />
                                Overdue · due {format(parseISO(c.due_date), "MMM d")}
                              </span>
                            ) : (
                              <>Due {format(parseISO(c.due_date), "MMM d")}</>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    {isMine && c.status !== "done" && c.status !== "dropped" && (
                      <Button size="sm" variant="outline" tabIndex={-1}>
                        Update
                      </Button>
                    )}
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

function StatusIcon({ status }: { status: string }) {
  if (status === "done")
    return <CheckCircle2 className="mt-0.5 size-4 text-green-600" />
  if (status === "dropped")
    return <X className="mt-0.5 size-4 text-muted-foreground" />
  if (status === "carried_over")
    return <RotateCcw className="mt-0.5 size-4 text-amber-600" />
  return <Circle className="mt-0.5 size-4 text-muted-foreground" />
}
