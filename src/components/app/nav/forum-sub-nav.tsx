"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/forum/parking-lot", label: "Parking Lot", match: /^\/forum\/parking-lot/ },
  { href: "/forum/commitments", label: "Commitments", match: /^\/forum\/commitments/ },
  { href: "/forum/photos", label: "Photos", match: /^\/forum\/photos/ },
  { href: "/forum/members", label: "Members", match: /^\/forum\/members/ },
]

const QOL_ITEM = {
  href: "/forum/qol-history",
  label: "QOL History",
  match: /^\/forum\/qol-history/,
}

export function ForumSubNav({
  showQolHistory = false,
}: {
  showQolHistory?: boolean
}) {
  const pathname = usePathname()
  const items = showQolHistory ? [...ITEMS, QOL_ITEM] : ITEMS
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border bg-background p-1 text-sm">
      {items.map((item) => {
        const active = item.match.test(pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-center transition-colors",
              active
                ? "bg-muted font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
