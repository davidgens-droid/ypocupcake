"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { joinForum } from "@/lib/forums/actions"

export function JoinForm({ token, forumName }: { token: string; forumName: string }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        const res = await joinForum({ token, name })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(`Welcome to ${forumName}.`)
        router.push("/dashboard")
        router.refresh()
      } catch {
        toast.error("Couldn't join. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-sm text-muted-foreground">You&apos;ve been invited to join</p>
        <h1 className="font-heading text-2xl font-semibold">{forumName}</h1>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="join-name">Your name</Label>
          <Input
            id="join-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoFocus
            autoComplete="name"
            placeholder="As your forum knows you"
          />
          <p className="text-xs text-muted-foreground">
            Shown to the other members of {forumName}. You can change it later.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={pending || !name.trim()}>
          {pending ? "Joining…" : `Join ${forumName}`}
        </Button>
      </form>
    </div>
  )
}
