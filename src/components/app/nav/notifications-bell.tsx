"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Bell, Check } from "lucide-react"
import { formatDistanceToNow, parseISO } from "date-fns"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
} from "@/lib/notifications/actions"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type Props = { memberId: string }

export function NotificationsBell({ memberId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [, startTransition] = useTransition()

  // Initial load
  useEffect(() => {
    listNotifications().then(setItems)
  }, [])

  // Realtime subscription — append on insert, update on change
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`notifications:${memberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `member_id=eq.${memberId}`,
        },
        () => {
          listNotifications().then(setItems)
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [memberId])

  const unread = items.filter((n) => !n.read_at).length

  function clickItem(n: Notification) {
    startTransition(async () => {
      if (!n.read_at) await markRead(n.id)
      setOpen(false)
      if (n.link) router.push(n.link)
    })
  }

  function clearAll() {
    startTransition(async () => {
      await markAllRead()
      setItems((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
      )
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="relative flex size-8 items-center justify-center rounded-md hover:bg-muted"
            aria-label="Notifications"
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 p-0 text-sm"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="font-medium">Notifications</p>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAll}
              className="h-6 gap-1 px-2 text-xs"
            >
              <Check className="size-3" /> Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </p>
        ) : (
          <ul className="max-h-80 overflow-auto divide-y">
            {items.map((n) => (
              <li key={n.id}>
                {n.link ? (
                  <Link
                    href={n.link}
                    onClick={(e) => {
                      e.preventDefault()
                      clickItem(n)
                    }}
                    className={cn(
                      "block px-3 py-2 hover:bg-muted/50",
                      !n.read_at && "bg-muted/30"
                    )}
                  >
                    <NotificationRow n={n} />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => clickItem(n)}
                    className={cn(
                      "block w-full px-3 py-2 text-left hover:bg-muted/50",
                      !n.read_at && "bg-muted/30"
                    )}
                  >
                    <NotificationRow n={n} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

function NotificationRow({ n }: { n: Notification }) {
  return (
    <div className="flex items-start gap-2">
      {!n.read_at && (
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-foreground" />
      )}
      <div className="flex-1 space-y-0.5">
        <p className="font-medium text-sm leading-tight">{n.title}</p>
        {n.detail && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {n.detail}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  )
}
