"use client"

import { useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { removeCharterDocument, setCharterDocument } from "@/lib/admin/actions"
import {
  CHARTER_ACCEPT,
  CHARTER_MAX_BYTES,
  CHARTER_MIME_BY_EXT,
  formatBytes,
  type CharterDocument,
} from "@/lib/forums/charter"
import { createClient } from "@/lib/supabase/client"

type Props = {
  forumId: string
  current: CharterDocument | null
  /** Short-lived link to open the current document, made on the server. */
  signedUrl: string | null
}

/**
 * Upload / replace / remove the charter document. The file goes straight
 * from the browser to the private 'charters' bucket (the bucket's own rules
 * only let this forum's admins write there), then the server records it.
 */
export function CharterDocumentUploader({ forumId, current, signedUrl }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const type = CHARTER_MIME_BY_EXT[ext]
    if (!type) {
      toast.error("Upload a PDF, Word, text or image file.")
      return
    }
    if (file.size > CHARTER_MAX_BYTES) {
      toast.error("That file is over 20 MB.")
      return
    }
    startTransition(async () => {
      try {
        const supabase = createClient()
        const path = `${forumId}/${crypto.randomUUID()}.${ext}`
        // The bucket allow-lists MIME types and the upload carries the File's
        // own type, which some browsers leave blank for .doc/.docx: re-wrap
        // so the type we validated is the one that's sent.
        const body = file.type === type ? file : new File([file], file.name, { type })
        const { error } = await supabase.storage
          .from("charters")
          .upload(path, body, { contentType: type, upsert: false })
        if (error) {
          toast.error(`Upload failed: ${error.message}`)
          return
        }
        const res = await setCharterDocument({ path, name: file.name, size: file.size, type })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(current ? "Charter document replaced." : "Charter document uploaded.")
        router.refresh()
      } catch {
        toast.error("Couldn't upload. Check your connection and try again.")
      }
    })
  }

  function remove() {
    if (!window.confirm("Remove the charter document? Members will no longer be able to open it. Any text charter stays.")) return
    startTransition(async () => {
      try {
        const res = await removeCharterDocument()
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success("Charter document removed.")
        router.refresh()
      } catch {
        toast.error("Couldn't remove. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="space-y-3">
      {current ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <FileText className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={current.name}>
              {current.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(current.size)}
              {current.uploaded_at ? ` · uploaded ${format(parseISO(current.uploaded_at), "MMM d, yyyy")}` : ""}
            </p>
          </div>
          {signedUrl && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              render={<a href={signedUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink className="size-4" /> Open
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No document uploaded yet.</p>
      )}

      <input ref={inputRef} type="file" accept={CHARTER_ACCEPT} className="hidden" onChange={onPick} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={current ? "outline" : "default"} className="gap-1" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" /> {pending ? "Working…" : current ? "Replace document" : "Upload a document"}
        </Button>
        {current && (
          <Button type="button" variant="ghost" className="gap-1 text-destructive hover:bg-destructive/10" disabled={pending} onClick={remove}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PDF, Word, text or image, up to 20 MB. Visible to your forum&apos;s members only.</p>
    </div>
  )
}
