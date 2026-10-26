import { MeSubNav } from "@/components/app/nav/me-sub-nav"

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <MeSubNav />
      {children}
    </div>
  )
}
