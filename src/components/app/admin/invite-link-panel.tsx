"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import { Check, Copy, Link2, RefreshCw, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { InviteLinkRow } from "@/app/(app)/admin/invite/page"
import { createInviteLink, revokeInviteLink } from "@/lib/forums/actions"

type Joiner = { id: string; name: string; joinedAt: string; linkId: string; status: string }

type Props = {
  origin: string
  active: InviteLinkRow | null
  history: InviteLinkRow[]
  joiners: Joiner[]
}

export function InviteLinkPanel({ origin, active, history, joiners }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  const [expiresDays, setExpiresDays] = useState(14)
  const [maxUses, setMaxUses] = useState(25)
  const [unlimited, setUnlimited] = useState(false)

  const url = active ? `${origin}/join/${active.token}` : null
  const nowMs = new Date().getTime()

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied.")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.")
    }
  }

  function revoke() {
    if (!active) return
    if (!window.confirm("Revoke this link? Anyone who hasn't joined yet will need a new one.")) return
    startTransition(async () => {
      try {
        const res = await revokeInviteLink(active.id)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success("Link revoked.")
        router.refresh()
      } catch {
        toast.error("Couldn't revoke. Check your connection and try again.")
      }
    })
  }

  function create(e: React.FormEvent) {
    e.preventDefault()
    if (active && !window.confirm("Creating a new link retires the current one. Continue?")) return
    startTransition(async () => {
      try {
        const res = await createInviteLink({ expiresDays, maxUses: unlimited ? null : maxUses })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success("New invite link ready.")
        router.refresh()
      } catch {
        toast.error("Couldn't create the link. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" /> {active ? "Current link" : "No active link"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {active && url ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copy} className="shrink-0 gap-1">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires {format(parseISO(active.expires_at), "MMM d, yyyy")} · used {active.uses}
                {active.max_uses != null ? ` of ${active.max_uses}` : " (no limit)"}
              </p>
              <Button type="button" variant="ghost" size="sm" className="gap-1 text-destructive hover:bg-destructive/10" disabled={pending} onClick={revoke}>
                <XCircle className="size-4" /> Revoke link
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Create one below and share it with your members.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4" /> {active ? "New link" : "Create a link"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expires-days">Valid for (days)</Label>
              <Input
                id="expires-days"
                type="number"
                min={1}
                max={90}
                value={expiresDays}
                onChange={(e) => setExpiresDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-uses">Maximum joins</Label>
              <Input
                id="max-uses"
                type="number"
                min={1}
                max={200}
                value={maxUses}
                disabled={unlimited}
                onChange={(e) => setMaxUses(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch id="unlimited" checked={unlimited} onCheckedChange={(v) => setUnlimited(!!v)} />
              <Label htmlFor="unlimited" className="text-sm">
                No limit on joins
              </Label>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Working…" : active ? "Replace with a new link" : "Create link"}
              </Button>
              {active && (
                <p className="mt-2 text-xs text-muted-foreground">
                  The current link stops working the moment the new one is created.
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Joined via a link ({joiners.length})</h3>
        {joiners.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {joiners.map((j) => (
              <li key={j.id} className="flex items-center justify-between px-3 py-2">
                <span className={j.status === "removed" ? "text-muted-foreground line-through" : ""}>{j.name}</span>
                <span className="text-xs text-muted-foreground">
                  {format(parseISO(j.joinedAt), "MMM d, yyyy")}
                  {j.linkId === active?.id ? " · current link" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Past links</h3>
          <ul className="divide-y rounded-lg border text-xs text-muted-foreground">
            {history.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-3 py-2">
                <span>Created {format(parseISO(l.created_at), "MMM d, yyyy")}</span>
                <span>
                  {l.revoked_at
                    ? "revoked"
                    : new Date(l.expires_at).getTime() < nowMs
                      ? "expired"
                      : "used up"}{" "}
                  · {l.uses} join{l.uses === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
