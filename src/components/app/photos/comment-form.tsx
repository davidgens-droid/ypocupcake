"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { addComment } from "@/lib/photos/actions"

export function CommentForm({ photoId }: { photoId: string }) {
  const [body, setBody] = useState("")
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    const fd = new FormData()
    fd.set("photo_id", photoId)
    fd.set("body", body.trim())
    startTransition(async () => {
      try {
        await addComment(fd)
        setBody("")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't comment.")
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Textarea
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        placeholder="Add a comment…"
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Posting…" : "Post"}
        </Button>
      </div>
    </form>
  )
}
