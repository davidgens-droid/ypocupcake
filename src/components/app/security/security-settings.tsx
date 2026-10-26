"use client"

import { useEffect, useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import { Fingerprint, KeyRound, LifeBuoy, Lock, RotateCcw, ShieldAlert, Smartphone, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MIN_PASSPHRASE_LENGTH } from "@/lib/crypto/keys"
import { biometricLabel, passkeyApiAvailable } from "@/lib/crypto/passkey"
import { getKeySnapshot, lockKey, restoreKey, subscribeKey, type KeySnapshot } from "@/lib/crypto/session"
import {
  addPasskeyWrap,
  getMyKeyWraps,
  removeKeyWrap,
  replaceKeyWrap,
  resetEncryptedData,
  type KeyWrap,
} from "@/lib/security/actions"
import { getMyLegacyUpdates } from "@/lib/updates/actions"

import { RecoveryCodeCard } from "./recovery-code-card"
import { SetupFlow } from "./setup-flow"
import type { GateMember } from "./unlock-gate"
import {
  makePasskeyWrap,
  makePassphraseWrap,
  makeRecoveryWrap,
  sweepLegacyUpdates,
  UnlockError,
  unlockWithPasskey,
  unlockWithPassphrase,
  unlockWithRecovery,
} from "./unlock-core"

const subscribeNever = () => () => {}
const passkeyOnClient = () => passkeyApiAvailable()
const passkeyOnServer = () => false
const SERVER_SNAPSHOT: KeySnapshot = { memberId: null, key: null, keyId: null, checked: false }
const getServerSnapshot = () => SERVER_SNAPSHOT

/** Me → Security. Spec §3, §10. */
export function SecuritySettings({ member }: { member: GateMember }) {
  const router = useRouter()
  const snap = useSyncExternalStore(subscribeKey, getKeySnapshot, getServerSnapshot)
  const canPasskey = useSyncExternalStore(subscribeNever, passkeyOnClient, passkeyOnServer)
  const [wraps, setWraps] = useState<KeyWrap[] | null>(null)
  const [unprotected, setUnprotected] = useState(0)
  const [pending, startTransition] = useTransition()
  const [newRecovery, setNewRecovery] = useState<string | null>(null)
  const [resetWord, setResetWord] = useState("")
  const [reauth, setReauth] = useState<null | { purpose: "passkey" | "passphrase" | "recovery"; via: "choose" | "passphrase" | "recovery"; secret: string; newPassphrase: string; confirm: string }>(null)

  const unlockedHere = snap.checked && snap.memberId === member.id && !!snap.key && !!snap.keyId

  async function reload() {
    const [w, legacy] = await Promise.all([getMyKeyWraps(), getMyLegacyUpdates()])
    setWraps(w)
    setUnprotected(legacy.length)
  }
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await restoreKey(member.id)
      const [w, legacy] = await Promise.all([getMyKeyWraps(), getMyLegacyUpdates()])
      if (cancelled) return
      // A key retired by "Start fresh" elsewhere must not count as unlocked here.
      if (cached && !w.some((x) => x.key_id === cached.keyId)) await lockKey(member.id)
      setWraps(w)
      setUnprotected(legacy.length)
    })().catch(() => {
      if (!cancelled) toast.error("Couldn't load your protection settings. Reload to try again.")
    })
    return () => {
      cancelled = true
    }
  }, [member.id])

  if (wraps === null) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    )
  }
  if (wraps.length === 0) return <SetupFlow member={member} onDone={reload} onNeedsReload={reload} />

  const passkeys = wraps.filter((w) => w.kind === "passkey")
  const hasPassphrase = wraps.some((w) => w.kind === "passphrase")

  // Security changes need the extractable key for a moment: a fresh unlock, every time.
  async function freshKey(r: NonNullable<typeof reauth>): Promise<CryptoKey> {
    if (r.via === "choose") return (await unlockWithPasskey(wraps!, true)).key
    if (r.via === "passphrase") return (await unlockWithPassphrase(wraps!, r.secret, true)).key
    return (await unlockWithRecovery(wraps!, r.secret, true)).key
  }

  function runReauth() {
    const r = reauth
    if (!r) return
    startTransition(async () => {
      try {
        const uk = await freshKey(r)
        if (r.purpose === "passkey") {
          const wrap = await makePasskeyWrap(uk, member)
          if (!wrap) {
            toast.info("This device can't use a passkey for this.")
            return
          }
          const res = await addPasskeyWrap(wrap)
          if (!res.ok) return void toast.error(res.error)
          toast.success("This device can now unlock with " + biometricLabel() + ".")
        } else if (r.purpose === "passphrase") {
          if (r.newPassphrase.length < MIN_PASSPHRASE_LENGTH) return void toast.error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`)
          if (r.newPassphrase !== r.confirm) return void toast.error("The two passphrases don't match.")
          const res = await replaceKeyWrap(await makePassphraseWrap(uk, r.newPassphrase))
          if (!res.ok) return void toast.error(res.error)
          toast.success(hasPassphrase ? "Passphrase changed." : "Passphrase set.")
        } else {
          const { wrap, display } = await makeRecoveryWrap(uk)
          const res = await replaceKeyWrap(wrap)
          if (!res.ok) return void toast.error(res.error)
          setNewRecovery(display)
        }
        setReauth(null)
        await reload()
      } catch (err) {
        toast.error(err instanceof UnlockError ? err.message : "That didn't work. Try again.")
      }
    })
  }

  function remove(w: KeyWrap) {
    if (!window.confirm(`Remove ${w.label ?? "this device"}? It will no longer be able to unlock your updates.`)) return
    startTransition(async () => {
      const res = await removeKeyWrap(w.id)
      if (!res.ok) return void toast.error(res.error)
      toast.success("Removed.")
      await reload()
    })
  }

  function lockNow() {
    startTransition(async () => {
      await lockKey(member.id)
      toast.success("Locked on this device.")
    })
  }

  function startFresh() {
    startTransition(async () => {
      const res = await resetEncryptedData(resetWord)
      if (!res.ok) return void toast.error(res.error)
      await lockKey(member.id)
      setResetWord("")
      toast.success("Your update content was erased. Set up protection again to start fresh.")
      await reload()
      router.refresh()
    })
  }

  function protectNow() {
    const key = snap.key
    const keyId = snap.keyId
    if (!key || !keyId) return
    startTransition(async () => {
      try {
        const r = await sweepLegacyUpdates(member.id, key, keyId)
        setUnprotected(r.remaining)
        if (r.remaining === 0) toast.success(`${r.total} past update${r.total === 1 ? "" : "s"} protected.`)
        else toast.error(`${r.remaining} still couldn't be protected. Try again in a moment.`)
      } catch {
        toast.error("That didn't work. Try again in a moment.")
      }
    })
  }

  const begin = (purpose: "passkey" | "passphrase" | "recovery") =>
    setReauth({ purpose, via: passkeys.length > 0 && canPasskey ? "choose" : hasPassphrase ? "passphrase" : "recovery", secret: "", newPassphrase: "", confirm: "" })

  return (
    <div className="space-y-4">
      {newRecovery && (
        <Card>
          <CardContent className="py-4">
            <RecoveryCodeCard code={newRecovery} forumName={member.forumName} onAcknowledged={() => setNewRecovery(null)} />
          </CardContent>
        </Card>
      )}

      {unprotected > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" /> {unprotected} past update{unprotected === 1 ? "" : "s"} not protected yet
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <p className="text-muted-foreground">
              {unlockedHere
                ? "These are still stored readable on the server. Protect them now with the key on this device."
                : "These are still stored readable on the server. They're protected automatically the next time you unlock on any device."}
            </p>
            {unlockedHere && (
              <Button type="button" size="sm" disabled={pending} onClick={protectNow}>
                {pending ? "Working…" : "Protect now"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4" /> This device
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <p className="text-muted-foreground">{unlockedHere ? "Unlocked. Stays unlocked for 30 days or until you sign out." : "Locked."}</p>
          {unlockedHere && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={lockNow}>
              Lock now
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" /> Devices
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {passkeys.length === 0 ? (
            <p className="text-muted-foreground">No device passkeys yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {passkeys.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="font-medium">{w.label ?? "Device"}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {format(parseISO(w.created_at), "MMM d, yyyy")}
                      {w.last_used_at ? ` · last used ${format(parseISO(w.last_used_at), "MMM d, yyyy")}` : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" disabled={pending} onClick={() => remove(w)} aria-label="Remove device">
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {canPasskey && (
            <Button type="button" size="sm" variant="outline" className="gap-1" disabled={pending} onClick={() => begin("passkey")}>
              <Fingerprint className="size-4" /> Add this device ({biometricLabel()})
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> Passphrase
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{hasPassphrase ? "A passphrase is set. It works on any device." : "No passphrase set. Add one as a fallback for devices without a passkey."}</p>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => begin("passphrase")}>
            {hasPassphrase ? "Change passphrase" : "Set a passphrase"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="size-4" /> Recovery code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Your way back in if you lose every device and the passphrase. Generating a new one cancels the old one.</p>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => begin("recovery")}>
            Generate a new recovery code
          </Button>
        </CardContent>
      </Card>

      {reauth && (
        <Card className="border-foreground/40">
          <CardHeader>
            <CardTitle className="text-base">
              {reauth.purpose === "passkey" ? "Add this device" : reauth.purpose === "passphrase" ? (hasPassphrase ? "Change passphrase" : "Set a passphrase") : "New recovery code"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                runReauth()
              }}
            >
              <p className="text-sm text-muted-foreground">First, confirm it&apos;s you.</p>
              {reauth.via === "choose" ? (
                <p className="text-sm">You&apos;ll be asked for {biometricLabel()} when you continue.</p>
              ) : reauth.via === "passphrase" ? (
                <div className="space-y-2">
                  <Label htmlFor="reauth-pp">Current passphrase</Label>
                  <Input id="reauth-pp" type="password" autoComplete="current-password" value={reauth.secret} onChange={(e) => setReauth({ ...reauth, secret: e.target.value })} />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="reauth-rc">Recovery code</Label>
                  <Input id="reauth-rc" value={reauth.secret} onChange={(e) => setReauth({ ...reauth, secret: e.target.value })} className="font-mono" autoComplete="off" />
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                {reauth.via !== "choose" && passkeys.length > 0 && canPasskey && (
                  <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setReauth({ ...reauth, via: "choose", secret: "" })}>
                    Use {biometricLabel()}
                  </button>
                )}
                {reauth.via !== "passphrase" && hasPassphrase && (
                  <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setReauth({ ...reauth, via: "passphrase", secret: "" })}>
                    Use passphrase
                  </button>
                )}
                {reauth.via !== "recovery" && (
                  <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setReauth({ ...reauth, via: "recovery", secret: "" })}>
                    Use recovery code
                  </button>
                )}
              </div>

              {reauth.purpose === "passphrase" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="new-pp">New passphrase (at least {MIN_PASSPHRASE_LENGTH} characters)</Label>
                    <Input id="new-pp" type="password" autoComplete="new-password" value={reauth.newPassphrase} onChange={(e) => setReauth({ ...reauth, newPassphrase: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-pp2">Type it again</Label>
                    <Input id="new-pp2" type="password" autoComplete="new-password" value={reauth.confirm} onChange={(e) => setReauth({ ...reauth, confirm: e.target.value })} />
                  </div>
                </>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "Working…" : "Continue"}
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setReauth(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="size-4" /> Start fresh
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Lost every device, the passphrase and the recovery code? This erases the written content of all your updates and your pattern cards for good — nobody, including admins, can recover them — and lets you set up protection again. Your Quality of Life scores, topics you published and your commitments stay.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-40" placeholder="Type RESET" value={resetWord} onChange={(e) => setResetWord(e.target.value)} autoComplete="off" />
            <Button type="button" variant="outline" className="text-destructive" disabled={pending || resetWord !== "RESET"} onClick={startFresh}>
              Erase my updates and start fresh
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
