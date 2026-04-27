"use client"

import { useState, useTransition } from "react"
import { Sparkles } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { generateUpdateFromBrainDump } from "@/lib/ai/brain-dump"
import type { UpdateContent } from "@/lib/updates/schema"

type Props = {
  onContentReady: (content: UpdateContent) => void
}

export function BrainDumpDialog({ onContentReady }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [pending, startTransition] = useTransition()

  function onGenerate() {
    if (text.trim().length < 10) {
      toast.error("Brain-dump is a bit short — give me at least a paragraph.")
      return
    }
    startTransition(async () => {
      const result = await generateUpdateFromBrainDump({ brainDump: text })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onContentReady(result.content)
      toast.success("Update structured. Review and edit each field.")
      setOpen(false)
      setText("")
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="fixed bottom-20 right-4 z-30 gap-2 shadow-lg md:bottom-6"
          />
        }
      >
        <Sparkles className="size-4" />
        Brain-dump
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Brain-dump mode
          </DialogTitle>
          <DialogDescription>
            Talk or type freely. I&apos;ll structure it into your update fields
            and you can review every section before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's been going on for you this last month? Business, family, personal — say it however it comes out."
            disabled={pending}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Privacy: this is processed by Claude with zero retention. Only you
            ever see the result.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onGenerate} disabled={pending || text.trim().length < 10}>
            {pending ? "Structuring…" : "Generate update"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
