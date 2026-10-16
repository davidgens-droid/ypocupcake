"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { extractInviteToken } from "@/lib/forums/invite-token"

/** Compact "paste your invite link" form; sends the visitor to /join/<token>. */
export function InviteLinkEntry() {
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
    <form onSubmit={go} className="flex gap-2">
      <Input
        aria-label="Invite link"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Paste the link your forum's admin sent you"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" variant="outline" disabled={!token} className="shrink-0">
        Go
      </Button>
    </form>
  )
}
