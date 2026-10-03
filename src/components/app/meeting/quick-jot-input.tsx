"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RotateCcw, X, Zap } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { captureParkingLotItem } from "@/lib/parking-lot/actions"

/** A jot whose save failed, kept until the moderator retries or dismisses it. */
export type FailedJot = {
  id: string
  topic: string
  presenterMemberId: string
  presenterName: string
}

type InputProps = {
  meetingId: string
  presenterMemberId: string
  presenterName: string
  onFailed: (jot: FailedJot) => void
}

/**
 * Zero-click parking-lot capture for the moderator while someone is speaking:
 * type a note, press Enter, it's parked for the current presenter, the input
 * clears and keeps focus so the next note can go straight in. Uses the same
 * defaults as the full "Park a topic" form (Four-Step format, EQ, medium
 * urgency); context and exploration type are refined later in the
 * post-meeting Review screen (Edit) or on the item itself.
 *
 * Mount with `key={presenterMemberId}` so the per-turn counter and any
 * half-typed note reset when the presenter changes. A failed save is handed
 * UP via `onFailed` (never kept only in this instance), so it survives that
 * remount and can be retried against the right presenter.
 */
function QuickJotInput({
  meetingId,
  presenterMemberId,
  presenterName,
  onFailed,
}: InputProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState("")
  const [count, setCount] = useState(0)
  const [pending, startTransition] = useTransition()

  const firstName = presenterName.split(" ")[0]

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const topic = value.trim()
    if (topic.length < 2) return

    // Optimistic: clear immediately and keep focus so the moderator can keep
    // jotting while this one saves (the insert is fast).
    setValue("")
    inputRef.current?.focus()

    startTransition(async () => {
      try {
        await captureParkingLotItem({
          meetingId,
          presenterMemberId,
          topic,
          context: "",
        })
        setCount((c) => c + 1)
        // Refreshes the "Review captured topics (N)" count in the runner.
        router.refresh()
      } catch {
        // Don't surface the raw error — in production it's the scrubbed
        // "Server Components render…" text. The durable recovery path is the
        // failed-notes list the parent renders; the toast just points there.
        onFailed({
          id: crypto.randomUUID(),
          topic,
          presenterMemberId,
          presenterName,
        })
        toast.error("Couldn't park that note — it's kept below with a Retry button.", {
          duration: 8000,
        })
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1">
      <div className="relative">
        <Zap className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Jot a note for ${firstName}… press Enter to park it`}
          className="pl-9"
          maxLength={500}
          autoComplete="off"
          enterKeyHint="send"
          aria-label={`Quick parking-lot note for ${presenterName}`}
        />
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {pending
          ? "Parking…"
          : count > 0
            ? `${count} parked for ${firstName} this turn · add context & format later in Review`
            : "Type and press Enter — no clicks. Add context & exploration type later."}
      </p>
    </form>
  )
}

type PanelProps = {
  meetingId: string
  presenterMemberId: string
  presenterName: string
  /** Lives in the runner so it outlives presenter changes and round/phase moves. */
  failed: FailedJot[]
  setFailed: React.Dispatch<React.SetStateAction<FailedJot[]>>
}

/**
 * The quick-jot input for the current presenter plus the list of any notes
 * whose save failed. The input is keyed per presenter (resets each turn); the
 * failed list is NOT — it comes from runner-level state — so a note that
 * failed during Alex's turn is still here, attributed to Alex, during Sam's.
 */
export function QuickJotPanel({
  meetingId,
  presenterMemberId,
  presenterName,
  failed,
  setFailed,
}: PanelProps) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()
  const [retryingId, setRetryingId] = useState<string | null>(null)

  function retry(jot: FailedJot) {
    setRetryingId(jot.id)
    startRetry(async () => {
      try {
        await captureParkingLotItem({
          meetingId,
          // Re-submit to the presenter it was jotted for, not whoever is up now.
          presenterMemberId: jot.presenterMemberId,
          topic: jot.topic,
          context: "",
        })
        setFailed((list) => list.filter((f) => f.id !== jot.id))
        toast.success(`Parked for ${jot.presenterName.split(" ")[0]}.`)
        router.refresh()
      } catch {
        toast.error("Still couldn't park it — check your connection and try again.")
      } finally {
        setRetryingId(null)
      }
    })
  }

  return (
    <div className="space-y-2">
      <QuickJotInput
        key={presenterMemberId}
        meetingId={meetingId}
        presenterMemberId={presenterMemberId}
        presenterName={presenterName}
        onFailed={(jot) => setFailed((list) => [...list, jot])}
      />

      {failed.length > 0 && (
        <ul className="space-y-1" aria-label="Notes that didn't save">
          {failed.map((jot) => (
            <li
              key={jot.id}
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-destructive">
                  Didn&apos;t save · for {jot.presenterName.split(" ")[0]}
                </p>
                <p className="break-words text-foreground">{jot.topic}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2"
                disabled={retrying}
                onClick={() => retry(jot)}
              >
                <RotateCcw className="size-3" />
                {retryingId === jot.id ? "Retrying…" : "Retry"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                disabled={retrying}
                onClick={() =>
                  setFailed((list) => list.filter((f) => f.id !== jot.id))
                }
                aria-label="Dismiss this note"
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
