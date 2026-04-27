"use client"

import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { toggleReaction } from "@/lib/photos/actions"
import { cn } from "@/lib/utils"

const PRESET = ["❤️", "😂", "🎉", "🔥", "👏", "🙏"]

type Props = {
  photoId: string
  currentMemberId: string
  reactions: { member_id: string; emoji: string }[]
}

export function ReactionBar({ photoId, currentMemberId, reactions }: Props) {
  const [pending, startTransition] = useTransition()

  const grouped = reactions.reduce<Record<string, string[]>>((acc, r) => {
    ;(acc[r.emoji] ??= []).push(r.member_id)
    return acc
  }, {})

  const toggle = (emoji: string) => {
    const fd = new FormData()
    fd.set("photo_id", photoId)
    fd.set("emoji", emoji)
    startTransition(async () => {
      await toggleReaction(fd)
    })
  }

  const allEmojis = Array.from(
    new Set([...Object.keys(grouped), ...PRESET])
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allEmojis.map((emoji) => {
        const count = grouped[emoji]?.length ?? 0
        const mine = grouped[emoji]?.includes(currentMemberId) ?? false
        return (
          <button
            key={emoji}
            type="button"
            disabled={pending}
            onClick={() => toggle(emoji)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-1 text-sm transition-colors",
              mine ? "border-foreground bg-muted" : "hover:bg-muted/50",
              count === 0 ? "opacity-60" : ""
            )}
          >
            <span>{emoji}</span>
            {count > 0 && (
              <span className="text-xs text-muted-foreground">{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
