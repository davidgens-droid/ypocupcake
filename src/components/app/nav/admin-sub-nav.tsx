"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/admin/members", label: "Members", match: /^\/admin\/members/ },
  { href: "/admin/roles", label: "Roles", match: /^\/admin\/roles/ },
  { href: "/admin/meetings", label: "Calendar", match: /^\/admin\/meetings/ },
  { href: "/admin/charter", label: "Charter", match: /^\/admin\/charter/ },
]

export function AdminSubNav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg border bg-background p-1 text-sm">
      {ITEMS.map((item) => {
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
