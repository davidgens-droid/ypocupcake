"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Users,
  NotebookPen,
  Settings,
} from "lucide-react"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: Home, match: /^\/dashboard/ },
  {
    href: "/forum/parking-lot",
    label: "Forum",
    icon: Users,
    match: /^\/forum/,
  },
  { href: "/me/update", label: "Me", icon: NotebookPen, match: /^\/me/ },
  { href: "/admin", label: "More", icon: Settings, match: /^\/admin/ },
]

function NavLink({
  href,
  label,
  active,
  Icon,
  variant,
}: {
  href: string
  label: string
  active: boolean
  Icon: React.ComponentType<{ className?: string }>
  variant: "sidebar" | "tabbar"
}) {
  if (variant === "sidebar") {
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <Icon className="size-4" />
        {label}
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  )
}

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-56 shrink-0 border-r bg-background px-4 py-6 md:flex md:flex-col">
      <div className="px-2 pb-6">
        <p className="font-heading text-base font-semibold">Cupcake</p>
        <p className="text-xs text-muted-foreground">Forum companion</p>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            Icon={item.icon}
            active={item.match.test(pathname)}
            variant="sidebar"
          />
        ))}
      </nav>
    </aside>
  )
}

export function AppTabBar() {
  const pathname = usePathname()

  return (
    <nav className="sticky bottom-0 z-30 flex w-full border-t bg-background md:hidden">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          Icon={item.icon}
          active={item.match.test(pathname)}
          variant="tabbar"
        />
      ))}
    </nav>
  )
}
