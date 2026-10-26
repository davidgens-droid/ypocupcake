"use client"

import { useState } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

/** Shows a recovery code once, with Copy / Save-as-file and a required acknowledgement. */
export function RecoveryCodeCard({
  code,
  forumName,
  onAcknowledged,
  acknowledging = false,
}: {
  code: string
  forumName: string
  onAcknowledged: () => void
  acknowledging?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success("Copied.")
    } catch {
      toast.error("Couldn't copy — select the code and copy it by hand.")
    }
  }

  function download() {
    const text = `Cupcake recovery code (${forumName})\n\n${code}\n\nThis code unlocks your private updates if you ever lose access to your devices and passphrase. Nobody can recover them without it — not even the people who run Cupcake. Keep it somewhere safe, such as a password manager.\n`
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "cupcake-recovery-code.txt"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-heading text-lg font-semibold">Your recovery code</h3>
        <p className="text-sm text-muted-foreground">
          If you ever lose your devices and forget your passphrase, this is the
          only way back into your updates. Nobody can recover them for you,
          not even the people who run Cupcake. Save it somewhere safe, like a
          password manager.
        </p>
      </div>
      <p className="select-all rounded-lg border bg-muted/40 p-4 text-center font-mono text-lg tracking-wider">{code}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="gap-1" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
        </Button>
        <Button type="button" variant="outline" className="gap-1" onClick={download}>
          <Download className="size-4" /> Save as file
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I&apos;ve saved this code somewhere safe. I understand it won&apos;t be shown again.</span>
      </label>
      <Button type="button" disabled={!saved || acknowledging} onClick={onAcknowledged}>
        {acknowledging ? "Finishing…" : "Continue"}
      </Button>
    </div>
  )
}
