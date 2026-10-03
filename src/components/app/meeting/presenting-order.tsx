"use client"

import { useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  GripVertical,
  Shuffle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = {
  /** Full order for the round / phase, as stored on the server. */
  order: string[]
  currentIndex: number
  presenting: boolean
  memberName: Record<string, string>
  /** Disables the controls while an unrelated server action is in flight. */
  pending: boolean
  /**
   * Called with the new *remaining* order (everyone not yet revealed).
   * Resolves true when the server accepted it; false (after showing the
   * reason) when it didn't, so the list can snap back.
   */
  onReorder: (nextTail: string[]) => Promise<boolean>
  onShuffle: () => void
}

/**
 * Moderator-only list of the presenting order. Members never see this — their
 * view says the order is hidden, and that stays true.
 *
 * Everyone who has presented, plus whoever is up right now, is locked at the
 * top. The rest is the upcoming order: drag a name up or down (anywhere on
 * the row with a mouse; by the ⋮⋮ handle on touch, so the page can still
 * scroll), or use the arrows. "Shuffle the rest" re-randomises only the
 * upcoming part.
 */
export function PresentingOrder({
  order,
  currentIndex,
  presenting,
  memberName,
  pending,
  onReorder,
  onShuffle,
}: Props) {
  if (order.length === 0) return null

  const idx = Math.min(currentIndex, order.length)
  const locked = presenting ? Math.min(idx + 1, order.length) : idx
  const fixed = order.slice(0, locked)
  const tail = order.slice(locked)
  const doneCount = Math.min(currentIndex, order.length)

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Presenting order · {doneCount} of {order.length} done
        </p>
        {tail.length >= 2 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            disabled={pending}
            onClick={onShuffle}
            title="Re-randomise everyone who hasn't presented yet"
          >
            <Shuffle className="size-3.5" /> Shuffle the rest
          </Button>
        )}
      </div>
      <ol className="space-y-1">
        {fixed.map((id, i) => {
          const isCurrent = presenting && i === idx
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
            >
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              {isCurrent ? (
                <CircleDot className="size-4 shrink-0 text-foreground" />
              ) : (
                <Check className="size-4 shrink-0 text-emerald-600" />
              )}
              <span
                className={cn(
                  "truncate",
                  isCurrent ? "font-semibold" : "text-muted-foreground line-through"
                )}
              >
                {memberName[id] ?? "Unknown"}
              </span>
              <span className="sr-only">{isCurrent ? ", presenting now" : ", done"}</span>
              {isCurrent && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground" aria-hidden>
                  up now
                </span>
              )}
            </li>
          )
        })}
        <SortableTail
          tail={tail}
          firstPosition={locked + 1}
          memberName={memberName}
          pending={pending}
          onReorder={onReorder}
        />
      </ol>
      {tail.length >= 2 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Drag a name (with a mouse) or its ⋮⋮ handle (on touch) to change who&apos;s
          next, or use the arrows. Only the moderator sees this list.
        </p>
      )}
    </div>
  )
}

type Drag = {
  id: string
  from: number
  to: number
  dy: number
  /** Height of the dragged row, used to shift the rows it passes. */
  h: number
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function SortableTail({
  tail,
  firstPosition,
  memberName,
  pending,
  onReorder,
}: {
  tail: string[]
  firstPosition: number
  memberName: Record<string, string>
  pending: boolean
  onReorder: (next: string[]) => Promise<boolean>
}) {
  const [items, setItems] = useState(tail)
  // Reconcile with the server without remounting (a remount would drop
  // keyboard focus from the arrow button that was just pressed). Standard
  // "adjust state when a prop changes" pattern: only when the server's tail
  // genuinely differs from what we show.
  const [seenTail, setSeenTail] = useState(tail)
  if (seenTail !== tail) {
    setSeenTail(tail)
    if (!sameOrder(tail, items)) setItems(tail)
  }

  const [drag, setDrag] = useState<Drag | null>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  // Everything the move/up handlers need, outside React state so a fast
  // sequence of pointer events never reads a stale closure.
  const dragRef = useRef<{
    id: string
    from: number
    to: number
    startY: number
    pointerId: number
    rects: { top: number; h: number }[]
  } | null>(null)
  // True while a reorder is being saved; new gestures wait for the verdict so
  // two optimistic edits can't race each other to the server.
  const savingRef = useRef(false)

  const canSort = !pending && items.length >= 2

  function commit(next: string[]) {
    if (sameOrder(next, items)) return
    const prev = items
    setItems(next)
    savingRef.current = true
    onReorder(next)
      .then((ok) => {
        if (!ok) setItems(prev)
      })
      .catch(() => setItems(prev))
      .finally(() => {
        savingRef.current = false
      })
  }

  function onPointerDown(e: React.PointerEvent<HTMLLIElement>, id: string, index: number) {
    if (!canSort || savingRef.current) return
    // One gesture at a time — a second finger must not hijack the drag.
    if (dragRef.current) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    // On touch, only the grip starts a drag — a finger on the name should
    // still scroll the page.
    if (
      e.pointerType !== "mouse" &&
      !(e.target as HTMLElement).closest("[data-grip]")
    ) {
      return
    }
    // Buttons inside the row keep their own behaviour.
    if ((e.target as HTMLElement).closest("button")) return
    e.preventDefault()
    const rects = items.map((itemId) => {
      const r = rowRefs.current.get(itemId)?.getBoundingClientRect()
      return { top: r?.top ?? 0, h: r?.height ?? 0 }
    })
    dragRef.current = {
      id,
      from: index,
      to: index,
      startY: e.clientY,
      pointerId: e.pointerId,
      rects,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ id, from: index, to: index, dy: 0, h: rects[index].h })
  }

  function onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    // The list changed under the gesture (server refresh) — abandon it.
    if (items[d.from] !== d.id) {
      dragRef.current = null
      setDrag(null)
      return
    }
    const dy = e.clientY - d.startY
    const center = d.rects[d.from].top + d.rects[d.from].h / 2 + dy
    // New index = how many *other* rows' midpoints the dragged row has passed.
    let to = 0
    d.rects.forEach((r, j) => {
      if (j !== d.from && r.top + r.h / 2 < center) to++
    })
    d.to = to
    setDrag({ id: d.id, from: d.from, to, dy, h: d.rects[d.from].h })
  }

  function endDrag(e: React.PointerEvent<HTMLLIElement>, commitMove: boolean) {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    dragRef.current = null
    setDrag(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
    if (commitMove && d.to !== d.from && items[d.from] === d.id) {
      commit(moveItem(items, d.from, d.to))
    }
  }

  function nudge(index: number, delta: -1 | 1) {
    // Buttons stay enabled (so focus survives); presses mid-save are ignored.
    if (!canSort || savingRef.current) return
    const to = index + delta
    if (to < 0 || to >= items.length) return
    commit(moveItem(items, index, to))
  }

  function styleFor(j: number): React.CSSProperties | undefined {
    if (!drag) return undefined
    if (j === drag.from) {
      return { transform: `translateY(${drag.dy}px)`, zIndex: 10, position: "relative" }
    }
    // Rows between the origin and the target slide out of the way.
    if (drag.from < drag.to && j > drag.from && j <= drag.to) {
      return { transform: `translateY(-${drag.h}px)`, transition: "transform 150ms" }
    }
    if (drag.to < drag.from && j >= drag.to && j < drag.from) {
      return { transform: `translateY(${drag.h}px)`, transition: "transform 150ms" }
    }
    return { transition: "transform 150ms" }
  }

  return (
    <>
      {items.map((id, j) => {
        const isDragging = drag?.id === id
        const name = memberName[id] ?? "Unknown"
        return (
          <li
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el)
              else rowRefs.current.delete(id)
            }}
            style={styleFor(j)}
            onPointerDown={(e) => onPointerDown(e, id, j)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            className={cn(
              "flex items-center gap-2 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm select-none",
              canSort && "cursor-grab",
              isDragging && "cursor-grabbing border-border bg-card shadow-md",
              drag && !isDragging && "pointer-events-none"
            )}
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {firstPosition + j}
            </span>
            {/* Generous hit area for the touch handle. */}
            <span
              data-grip
              className={cn(
                "flex h-9 w-8 shrink-0 items-center justify-center rounded text-muted-foreground",
                canSort ? "touch-none active:bg-muted" : "opacity-30"
              )}
              aria-hidden
            >
              <GripVertical className="size-4" />
            </span>
            <span className="truncate">{name}</span>
            {j === 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">next</span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8"
                aria-disabled={!canSort || j === 0}
                onClick={() => nudge(j, -1)}
                aria-label={`Move ${name} up`}
              >
                <ChevronUp className={cn("size-4", (!canSort || j === 0) && "opacity-30")} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8"
                aria-disabled={!canSort || j === items.length - 1}
                onClick={() => nudge(j, 1)}
                aria-label={`Move ${name} down`}
              >
                <ChevronDown
                  className={cn("size-4", (!canSort || j === items.length - 1) && "opacity-30")}
                />
              </Button>
            </span>
          </li>
        )
      })}
    </>
  )
}
