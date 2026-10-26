"use client"

import { useState, useSyncExternalStore, useTransition } from "react"
import { Fingerprint, KeyRound, LifeBuoy, Lock } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { biometricLabel, passkeyApiAvailable } from "@/lib/crypto/passkey"
import { touchKeyWrap, type KeyWrap } from "@/lib/security/actions"

import type { GateMember } from "./unlock-gate"
import { adoptUnlockedKey, UnlockError, unlockWithPasskey, unlockWithPassphrase, unlockWithRecovery, type Unlocked } from "./unlock-core"

const subscribeNever = () => () => {}
const passkeyOnClient = () => passkeyApiAvailable()
const passkeyOnServer = () => false

export function UnlockPanel({ member, wraps, compact = false }: { member: GateMember; wraps: KeyWrap[]; compact?: boolean }) {
  const canPasskey = useSyncExternalStore(subscribeNever, passkeyOnClient, passkeyOnServer)
  const hasPasskey = wraps.some((w) => w.kind === "passkey")
  const hasPassphrase = wraps.some((w) => w.kind === "passphrase")
  const hasRecovery = wraps.some((w) => w.kind === "recovery")
  const [mode, setMode] = useState<"choose" | "passphrase" | "recovery">(hasPasskey && canPasskey ? "choose" : hasPassphrase ? "passphrase" : "recovery")
  const [secret, setSecret] = useState("")
  const [pending, startTransition] = useTransition()

  async function finish(result: Unlocked, via: "passkey" | "passphrase" | "recovery") {
    await adoptUnlockedKey(member.id, result.key, result.keyId)
    void touchKeyWrap(result.wrapId)
    if (via === "recovery") {
      toast.success("Unlocked with your recovery code. Add this device under Me → Security so you won't need the code next time.")
    }
  }

  function run(fn: () => Promise<Unlocked>, via: "passkey" | "passphrase" | "recovery") {
    startTransition(async () => {
      try {
        await finish(await fn(), via)
      } catch (err) {
        toast.error(err instanceof UnlockError ? err.message : "Couldn't unlock. Try again.")
      }
    })
  }

  const body = (
    <div className="space-y-4">
      {mode === "choose" && (
        <div className="space-y-2">
          <Button type="button" className="w-full gap-2" disabled={pending} onClick={() => run(() => unlockWithPasskey(wraps), "passkey")}>
            <Fingerprint className="size-4" /> {pending ? "Unlocking…" : `Unlock with ${biometricLabel()}`}
          </Button>
          <div className="flex flex-wrap justify-center gap-3 text-xs">
            {hasPassphrase && (
              <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setMode("passphrase")}>
                Use my passphrase
              </button>
            )}
            {hasRecovery && (
              <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setMode("recovery")}>
                Use my recovery code
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "passphrase" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => unlockWithPassphrase(wraps, secret), "passphrase")
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="unlock-passphrase">Your passphrase</Label>
            <Input id="unlock-passphrase" type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="gap-2" disabled={pending || secret.length === 0}>
              <KeyRound className="size-4" /> {pending ? "Unlocking…" : "Unlock"}
            </Button>
            {hasPasskey && canPasskey && (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setMode("choose"); setSecret("") }}>
                Use {biometricLabel()} instead
              </button>
            )}
            {hasRecovery && (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setMode("recovery"); setSecret("") }}>
                Use my recovery code
              </button>
            )}
          </div>
        </form>
      )}

      {mode === "recovery" && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => unlockWithRecovery(wraps, secret), "recovery")
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="unlock-recovery">Your recovery code</Label>
            <Input id="unlock-recovery" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} className="font-mono" autoFocus />
            <p className="text-xs text-muted-foreground">The 32-character code you saved when you set up protection.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="gap-2" disabled={pending || secret.length < 32}>
              <LifeBuoy className="size-4" /> {pending ? "Unlocking…" : "Unlock"}
            </Button>
            {(hasPassphrase || (hasPasskey && canPasskey)) && (
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setMode(hasPasskey && canPasskey ? "choose" : "passphrase"); setSecret("") }}>
                Back
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )

  return (
    <Card className={compact ? "border-dashed" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4" /> {compact ? "Unlock to see this" : "Unlock your updates"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!compact && (
          <p className="mb-4 text-sm text-muted-foreground">
            Your updates are encrypted so that only you can read them. Unlock once on this device; it stays unlocked for 30 days or until you sign out.
          </p>
        )}
        {body}
      </CardContent>
    </Card>
  )
}
