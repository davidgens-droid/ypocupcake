import { cn } from "@/lib/utils"

const URGENCY_LABEL: Record<string, string> = {
  low: "LOW",
  med: "MED",
  high: "HIGH",
}

const URGENCY_DOT: Record<string, string> = {
  low: "bg-green-500",
  med: "bg-amber-500",
  high: "bg-red-500",
}

export function UrgencyDot({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn("size-2 rounded-full", URGENCY_DOT[value])} />
      <span className="font-medium tracking-wide text-muted-foreground">
        {URGENCY_LABEL[value]}
      </span>
    </span>
  )
}

export function CategoryBadge({ value }: { value: "EQ" | "IQ" }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
        value === "EQ"
          ? "bg-violet-100 text-violet-800"
          : "bg-sky-100 text-sky-800"
      )}
    >
      {value}
    </span>
  )
}

const STATUS_LABEL: Record<string, string> = {
  parked: "Parked",
  scheduled: "Scheduled",
  presented: "Presented",
  archived: "Archived",
  withdrawn: "Withdrawn",
  captured: "Captured in meeting",
}

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {STATUS_LABEL[value] ?? value}
    </span>
  )
}
