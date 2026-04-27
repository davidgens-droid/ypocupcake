import { AppSidebar, AppTabBar } from "@/components/app/nav/app-nav"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <AppSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        <AppTabBar />
      </div>
    </div>
  )
}
