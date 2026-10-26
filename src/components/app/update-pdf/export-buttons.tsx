"use client"

import { useState } from "react"
import { FileDown, Printer } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { UpdateContent } from "@/lib/updates/schema"
import { getUpdateExportMeta, type UpdateExportMeta } from "@/lib/updates/export-meta"

import { savePdfForUpdate } from "./save-pdf"

type Props = {
  meetingId: string
  content: UpdateContent
  /** Pass when the page already has it; otherwise fetched on click. */
  meta?: UpdateExportMeta | null
  size?: "sm" | "default"
}

/**
 * Print and Save as PDF, both on the device. Updates are end-to-end
 * encrypted, so nothing here goes through a server: Print opens the
 * device-rendered print view; Save as PDF builds a real PDF in the browser
 * and downloads it at once.
 */
export function UpdateExportButtons({ meetingId, content, meta, size = "sm" }: Props) {
  const [busy, setBusy] = useState(false)

  async function savePdf() {
    setBusy(true)
    try {
      const m = meta ?? (await getUpdateExportMeta(meetingId))
      if (!m) {
        toast.error("Couldn't prepare the PDF. Reload and try again.")
        return
      }
      await savePdfForUpdate(content, m)
    } catch (err) {
      console.error("[pdf] failed", err instanceof Error ? err.name : err)
      toast.error("Couldn't build the PDF on this device. Use Print and choose 'Save as PDF' instead.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size={size}
        type="button"
        className="gap-1"
        onClick={() => window.open(`/print/update/${meetingId}`, "_blank", "noopener")}
      >
        <Printer className="size-4" /> Print
      </Button>
      <Button variant="outline" size={size} type="button" className="gap-1" disabled={busy} onClick={savePdf}>
        <FileDown className="size-4" /> {busy ? "Building PDF…" : "Save as PDF"}
      </Button>
    </div>
  )
}
