"use client"

import { useMemo, useState } from "react"
import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { formatMeeting } from "@/lib/dates"
import { buildXlsx } from "@/lib/xlsx"

export type QolRow = {
  member_id: string
  member_name: string
  meeting_id: string
  scheduled_at: string
  physical: number | null
  mental: number | null
  financial: number | null
  friends: number | null
}

type MetricKey = "physical" | "mental" | "financial" | "friends"
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "physical", label: "Physical" },
  { key: "mental", label: "Mental" },
  { key: "financial", label: "Financial" },
  { key: "friends", label: "Friends/Community" },
]

const TIMEFRAMES: { value: string; label: string; months: number | null }[] = [
  { value: "all", label: "All time", months: null },
  { value: "24", label: "Past 2 years", months: 24 },
  { value: "12", label: "Past 12 months", months: 12 },
  { value: "6", label: "Past 6 months", months: 6 },
  { value: "3", label: "Past 3 months", months: 3 },
]

export function QolHistory({ rows, nowMs }: { rows: QolRow[]; nowMs: number }) {
  const [timeframe, setTimeframe] = useState("12")

  const { members, meetings, lookup } = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.value === timeframe)
    const cutoff =
      tf?.months == null ? 0 : nowMs - tf.months * 30 * 24 * 60 * 60 * 1000

    const inRange = rows.filter(
      (r) => new Date(r.scheduled_at).getTime() >= cutoff
    )

    // Distinct meetings (columns), chronological.
    const meetingMap = new Map<string, string>() // id -> scheduled_at
    const memberMap = new Map<string, string>() // id -> name
    const lookup = new Map<string, QolRow>() // `${member}|${meeting}` -> row
    for (const r of inRange) {
      meetingMap.set(r.meeting_id, r.scheduled_at)
      memberMap.set(r.member_id, r.member_name)
      lookup.set(`${r.member_id}|${r.meeting_id}`, r)
    }

    const meetings = [...meetingMap.entries()]
      .map(([id, scheduled_at]) => ({ id, scheduled_at }))
      .sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() -
          new Date(b.scheduled_at).getTime()
      )
    const members = [...memberMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { members, meetings, lookup }
  }, [rows, timeframe, nowMs])

  function exportXlsx() {
    const dateHeaders = meetings.map((m) =>
      formatMeeting(m.scheduled_at, "d-MMM-yyyy")
    )
    const grid: (string | number | null)[][] = []
    grid.push(["Name", ...dateHeaders])
    for (const member of members) {
      grid.push([member.name]) // member name on its own row
      for (const metric of METRICS) {
        const cells = meetings.map(
          (mt) => lookup.get(`${member.id}|${mt.id}`)?.[metric.key] ?? null
        )
        grid.push([metric.label, ...cells])
      }
    }
    const blob = buildXlsx(grid, "QOL History")
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `qol-history-${timeframe === "all" ? "all-time" : timeframe + "mo"}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? ""

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-48">
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v ?? timeframe)}>
            <SelectTrigger className="w-full">
              <span data-slot="select-value">{tfLabel}</span>
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={exportXlsx}
          disabled={meetings.length === 0}
        >
          <Download className="size-4" /> Export to Excel
        </Button>
      </div>

      {meetings.length === 0 ? (
        <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No finalized Quality-of-Life data in this timeframe yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 min-w-[9rem] bg-muted/50 px-3 py-2 text-left font-semibold">
                  Name
                </th>
                {meetings.map((m) => (
                  <th
                    key={m.id}
                    className="min-w-[3.5rem] px-2 py-2 text-center font-semibold whitespace-nowrap"
                    title={formatMeeting(m.scheduled_at, "EEE MMM d, yyyy")}
                  >
                    {formatMeeting(m.scheduled_at, "d-MMM")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <MemberRows
                  key={member.id}
                  member={member}
                  meetings={meetings}
                  lookup={lookup}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MemberRows({
  member,
  meetings,
  lookup,
}: {
  member: { id: string; name: string }
  meetings: { id: string; scheduled_at: string }[]
  lookup: Map<string, QolRow>
}) {
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td
          className="sticky left-0 z-10 bg-muted/20 px-3 pt-2 pb-1 font-heading font-semibold"
          colSpan={meetings.length + 1}
        >
          {member.name}
        </td>
      </tr>
      {METRICS.map((metric) => (
        <tr key={metric.key} className="border-b last:border-b-0">
          <td className="sticky left-0 z-10 bg-background px-3 py-1.5 pl-6 text-muted-foreground">
            {metric.label}
          </td>
          {meetings.map((mt) => {
            const v = lookup.get(`${member.id}|${mt.id}`)?.[metric.key]
            return (
              <td
                key={mt.id}
                className="px-2 py-1.5 text-center tabular-nums"
              >
                {v == null ? (
                  <span className="text-muted-foreground/30">·</span>
                ) : (
                  v
                )}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
