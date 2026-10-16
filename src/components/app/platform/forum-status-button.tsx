"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { PauseCircle, PlayCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { setForumStatus } from "@/lib/platform/actions"

export function ForumStatusButton({
  forumId,
  name,
  status,
  isOwn,
}: {
  forumId: string
  name: string
  status: "active" | "suspended"
  /** The operator's own forum: pausing it would lock the operator out too. */
  isOwn: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const suspending = status === "active"

  function act() {
    if (
      suspending &&
      !window.confirm(
        `Pause ${name}? Its members lose access immediately and see a "forum paused" page. Nothing is deleted; you can reactivate it here.`
      )
    ) {
      return
    }
    startTransition(async () => {
      try {
        const res = await setForumStatus({ forumId, status: suspending ? "suspended" : "active" })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(suspending ? `${name} paused.` : `${name} reactivated.`)
        router.refresh()
      } catch {
        toast.error("Couldn't save. Check your connection and try again.")
      }
    })
  }

  if (isOwn && suspending) {
    return (
      <span className="text-xs text-muted-foreground" title="Pausing your own forum would lock you out as well.">
        your forum
      </span>
    )
  }

  return suspending ? (
    <Button type="button" size="sm" variant="ghost" className="gap-1 text-destructive hover:bg-destructive/10" disabled={pending} onClick={act}>
      <PauseCircle className="size-4" /> Pause
    </Button>
  ) : (
    <Button type="button" size="sm" variant="outline" className="gap-1" disabled={pending} onClick={act}>
      <PlayCircle className="size-4" /> {pending ? "Working…" : "Reactivate"}
    </Button>
  )
}
