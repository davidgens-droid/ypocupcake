"use client"

import { format, parseISO } from "date-fns"

import type { UpdateContent } from "@/lib/updates/schema"
import type { UpdateExportMeta } from "@/lib/updates/export-meta"

/**
 * Build the update as a real PDF on this device and download it at once.
 * The renderer is loaded lazily (it's large) so it never ships with the app.
 */
export async function savePdfForUpdate(content: UpdateContent, meta: UpdateExportMeta): Promise<void> {
  const [{ pdf }, { UpdatePdf }, React] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./update-pdf"),
    import("react"),
  ])
  const finalizedLabel = meta.completedAt ? format(parseISO(meta.completedAt), "MMM d, yyyy") : null
  // The renderer types its root as a <Document> element; UpdatePdf renders one.
  const element = React.createElement(UpdatePdf, { content, meta, finalizedLabel }) as unknown as Parameters<typeof pdf>[0]
  const blob = await pdf(element).toBlob()
  const safeForum = meta.forumName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const d = new Date(meta.meetingDate)
  const datePart = Number.isNaN(d.getTime()) ? "update" : format(d, "yyyy-MM-dd")
  const name = `YPO-Update-${safeForum || "forum"}-${datePart}.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
