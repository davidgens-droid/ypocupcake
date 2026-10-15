"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { RotateCcw, UserMinus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { removeMember, restoreMember } from "@/lib/admin/actions"

/**
 * Remove / Restore for Admin → Members. A client component so the action's
 * returned error ("that would leave the forum with no admin") reaches the
 * admin as a toast instead of a scrubbed server error page.
 */
export function MemberStatusButton({
  memberId,
  name,
  mode,
}: {
  memberId: string
  name: string
  mode: "remove" | "restore"
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function act() {
    if (
      mode === "remove" &&
      !window.confirm(`Remove ${name} from the forum? They lose access immediately; their data is kept and can be restored.`)
    ) {
      return
    }
    startTransition(async () => {
      try {
        const res = mode === "remove" ? await removeMember(memberId) : await restoreMember(memberId)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(mode === "remove" ? `${name} removed.` : `${name} restored.`)
        router.refresh()
      } catch {
        toast.error("Couldn't save. Check your connection and try again.")
      }
    })
  }

  return mode === "remove" ? (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:bg-destructive/10"
      disabled={pending}
      onClick={act}
      title="Remove from the forum (their data is kept; access ends now)"
      aria-label={`Remove ${name}`}
    >
      <UserMinus className="size-4" />
    </Button>
  ) : (
    <Button type="button" size="sm" variant="outline" className="gap-1" disabled={pending} onClick={act}>
      <RotateCcw className="size-4" /> {pending ? "Restoring…" : "Restore"}
    </Button>
  )
}
