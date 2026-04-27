import { ForumSubNav } from "@/components/app/nav/forum-sub-nav"

export default function ForumLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <ForumSubNav />
      {children}
    </div>
  )
}
