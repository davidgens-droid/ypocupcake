import { redirect } from "next/navigation"

import { getCurrentMember, getMembershipStatus } from "@/lib/auth/current-member"
import { SignOutButton } from "@/components/app/nav/sign-out-button"

export default async function RemovedPage() {
  if (await getCurrentMember()) redirect("/dashboard")
  const status = await getMembershipStatus()
  if (status.kind !== "removed") redirect("/login")

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">You&apos;re no longer in {status.forumName}</h1>
      <p className="text-sm text-muted-foreground">
        An admin removed this account from the forum. Your past updates stay
        private to you and are kept; an admin can restore your access at any
        time. An account belongs to one forum, so joining a different forum
        needs a different email address.
      </p>
      <SignOutButton />
    </main>
  )
}
