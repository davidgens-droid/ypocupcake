import { Suspense } from "react"
import Link from "next/link"

import { LoginForm } from "@/components/auth/login-form"
import { SignOutButton } from "@/components/app/nav/sign-out-button"
import { JoinForm } from "@/components/onboarding/join-form"
import { Button } from "@/components/ui/button"
import { getMembershipStatus } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

type Params = Promise<{ token: string }>
type Peek = { forum_name: string | null; valid: boolean; reason: string; is_mine: boolean }

const REASONS: Record<string, string> = {
  expired: "This invite link has expired.",
  revoked: "This invite link was revoked.",
  exhausted: "This invite link has been used as many times as it allows.",
  forum_suspended: "This forum is paused and isn't taking new members right now.",
  unknown: "This invite link isn't valid. Check it was copied completely.",
}

/**
 * /join/<token>: the one public page that names a forum. peek_invite()
 * reveals only the forum's name and whether the link still works; joining
 * needs a signed-in account with no membership anywhere.
 */
export default async function JoinPage({ params }: { params: Params }) {
  const { token } = await params
  const safeToken = /^[A-Za-z0-9_-]{16,128}$/.test(token) ? token : null

  const supabase = await createClient()
  const peek: Peek | null = safeToken
    ? (((await supabase.rpc("peek_invite", { p_token: safeToken }).maybeSingle()).data as Peek | null) ?? null)
    : null
  const status = await getMembershipStatus()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 p-6">
      {!peek || !peek.valid ? (
        <Invalid reason={peek?.reason ?? "unknown"} forumName={peek?.forum_name ?? null} signedIn={status.kind !== "anonymous"} />
      ) : status.kind === "anonymous" ? (
        <>
          <div className="space-y-1 text-center">
            <p className="text-sm text-muted-foreground">You&apos;ve been invited to join</p>
            <h1 className="font-heading text-2xl font-semibold">{peek.forum_name}</h1>
          </div>
          <Suspense>
            <LoginForm mode="join" next={`/join/${safeToken}`} />
          </Suspense>
        </>
      ) : status.kind === "none" ? (
        <JoinForm token={safeToken!} forumName={peek.forum_name ?? "this forum"} />
      ) : (
        <AlreadyMember status={status} invitedTo={peek.forum_name ?? "this forum"} isMine={peek.is_mine} />
      )}
    </main>
  )
}

function Invalid({ reason, forumName, signedIn }: { reason: string; forumName: string | null; signedIn: boolean }) {
  return (
    <div className="space-y-4 text-center">
      <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
      <h1 className="font-heading text-2xl font-semibold">
        {forumName ? `Can't join ${forumName}` : "Invite link not valid"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {REASONS[reason] ?? REASONS.unknown}{" "}Ask the forum&apos;s admin for a fresh link.
      </p>
      <Button variant="outline" render={<Link href={signedIn ? "/dashboard" : "/login"} />}>
        {signedIn ? "Go to Cupcake" : "Sign in"}
      </Button>
    </div>
  )
}

function AlreadyMember({
  status,
  invitedTo,
  isMine,
}: {
  status: { kind: "member" | "removed" | "suspended"; forumName: string }
  invitedTo: string
  /** From peek_invite: the link points at the caller's own forum (by id — names aren't unique). */
  isMine: boolean
}) {
  const same = isMine
  return (
    <div className="space-y-4 text-center">
      <p className="text-sm tracking-wide text-muted-foreground uppercase">Cupcake</p>
      <h1 className="font-heading text-2xl font-semibold">
        {same && status.kind === "member" ? `You're already in ${status.forumName}` : "One forum per account"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {same && status.kind === "member" ? (
          <>This account is already a member of {status.forumName}, so there&apos;s nothing to accept.</>
        ) : (
          <>
            This email already belongs to {status.forumName}
            {status.kind === "removed" ? " (access was removed)" : status.kind === "suspended" ? " (currently paused)" : ""}.
            An account can belong to only one forum. To join {invitedTo}, sign out and sign in again
            with a different email address.
          </>
        )}
      </p>
      <div className="flex justify-center gap-2">
        {status.kind === "member" && (
          <Button render={<Link href="/dashboard" />}>Go to {status.forumName}</Button>
        )}
        <SignOutButton variant="outline" size="default" />
      </div>
    </div>
  )
}
