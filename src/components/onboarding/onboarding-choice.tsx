"use client"

import { useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Link2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createForum } from "@/lib/forums/actions"
import { extractInviteToken } from "@/lib/forums/invite-token"

// The browser's zone, read through useSyncExternalStore so SSR renders a
// stable default and the client corrects it without an effect.
const subscribeNever = () => () => {}
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const serverTimezone = () => null

type Props = {
  signupEnabled: boolean
  timezones: string[]
  createFirst: boolean
}

export function OnboardingChoice({ signupEnabled, timezones, createFirst }: Props) {
  const join = <JoinCard key="join" />
  const create = signupEnabled ? <CreateCard key="create" timezones={timezones} /> : <ClosedCard key="closed" />
  return <div className="space-y-4">{createFirst ? [create, join] : [join, create]}</div>
}

function JoinCard() {
  const router = useRouter()
  const [raw, setRaw] = useState("")
  const token = extractInviteToken(raw)

  function go(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      toast.error("That doesn't look like a Cupcake invite link.")
      return
    }
    router.push(`/join/${token}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> Have an invite link?
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={go} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="invite">Paste the link your forum&apos;s admin sent you</Label>
            <Input
              id="invite"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="https://www.ypocupcake.com/join/…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={!token}>
            Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CreateCard({ timezones }: { timezones: string[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState("")
  const [adminName, setAdminName] = useState("")
  const [chosenTz, setChosenTz] = useState<string | null>(null)
  const browserTz = useSyncExternalStore(subscribeNever, browserTimezone, serverTimezone)
  const tz = chosenTz ?? browserTz ?? "UTC"
  const options = timezones.includes(tz) ? timezones : [tz, ...timezones]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const res = await createForum({ name, timezone: tz, adminName })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(`${name.trim()} is ready.`)
        router.push("/dashboard")
        router.refresh()
      } catch {
        toast.error("Couldn't create the forum. Check your connection and try again.")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> Create a forum
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="forum-name">Forum name</Label>
            <Input
              id="forum-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={80}
              required
              placeholder="e.g. Cupcake"
              autoComplete="organization"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="your-name">Your name</Label>
            <Input
              id="your-name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              maxLength={120}
              required
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forum-tz">Timezone</Label>
            <select
              id="forum-tz"
              value={tz}
              onChange={(e) => setChosenTz(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {options.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Meeting times are scheduled in this zone. You can change it later.
            </p>
          </div>
          <Button type="submit" disabled={pending || name.trim().length < 2 || !adminName.trim()}>
            {pending ? "Creating…" : "Create forum"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You&apos;ll be the forum&apos;s admin and this year&apos;s moderator. You
            can hand both to someone else at any time.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

function ClosedCard() {
  return (
    <Card>
      <CardContent className="py-4 text-sm text-muted-foreground">
        Creating new forums isn&apos;t open yet. If your forum already uses
        Cupcake, its admin can send you an invite link.
      </CardContent>
    </Card>
  )
}
