"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { markParkingLotItemDiscussed } from "@/lib/parking-lot/actions"

export function MarkDiscussedButton({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [takeaways, setTakeaways] = useState("")
  const [pending, startTransition] = useTransition()

  function onConfirm() {
    startTransition(async () => {
      try {
        await markParkingLotItemDiscussed({ itemId, takeaways })
        toast.success("Marked as discussed.")
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant="outline" className="gap-1" />}
      >
        <CheckCircle2 className="size-4" /> Mark as discussed
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark this topic as discussed?</DialogTitle>
          <DialogDescription>
            Moves it out of the active parking lot without scheduling it into a
            meeting — for topics that came up organically. You can optionally
            capture any takeaways.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="takeaways">Takeaways (optional)</Label>
          <Textarea
            id="takeaways"
            value={takeaways}
            onChange={(e) => setTakeaways(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="What came out of the discussion?"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? "Saving…" : "Mark as discussed"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
