import { redirect } from "next/navigation"

import { getCurrentMember, getMembershipStatus } from "@/lib/auth/current-member"
import { SignOutButton } from "@/components/app/nav/sign-out-button"

export default async function SuspendedPage() {
  if (await getCurrentMember()) redirect("/dashboard")
  const status = await getMembershipStatus()
  if (status.kind !== "suspended") redirect("/login")

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">{status.forumName} is paused</h1>
      <p className="text-sm text-muted-foreground">
        This forum has been suspended, so its pages aren&apos;t available right now.
        Your updates and history are untouched. If you think this is a mistake,
        contact whoever set the forum up.
      </p>
      <SignOutButton />
    </main>
  )
}
