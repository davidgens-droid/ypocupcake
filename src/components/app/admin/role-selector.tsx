"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { setSingletonRole } from "@/lib/admin/actions"

type Member = { id: string; name: string }

type Props = {
  roleType:
    | "moderator"
    | "assistant_moderator"
    | "czar"
    | "secretary"
    | "treasurer"
    | "technology"
    | "retreat_planner"
    | "timekeeper"
    | "norm_observer"
    | "social_coordinator"
  label: string
  description: string
  year: number
  members: Member[]
  currentMemberId: string | null
}

export function RoleSelector({
  roleType,
  label,
  description,
  year,
  members,
  currentMemberId,
}: Props) {
  const [selected, setSelected] = useState<string>(currentMemberId ?? "")
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set("role_type", roleType)
        fd.set("year", String(year))
        fd.set("member_id", selected)
        await setSingletonRole(fd)
        toast.success(`${label} updated.`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save.")
      }
    })
  }

  const dirty = (currentMemberId ?? "") !== selected

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
          <SelectTrigger className="flex-1">
            <span data-slot="select-value">
              {members.find((m) => m.id === selected)?.name ?? "Unassigned"}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">— Unassigned —</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
