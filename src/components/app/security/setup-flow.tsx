"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { generateUpdateKey, MIN_PASSPHRASE_LENGTH } from "@/lib/crypto/keys"
import { biometricLabel, describePasskeyError, platformAuthenticatorAvailable } from "@/lib/crypto/passkey"
import { setupMemberKeys, type WrapInput } from "@/lib/security/actions"

import { RecoveryCodeCard } from "./recovery-code-card"
import type { GateMember } from "./unlock-gate"
import { adoptUnlockedKey, makePasskeyWrap, makePassphraseWrap, makeRecoveryWrap, sweepLegacyUpdates } from "./unlock-core"

/**
 * One-time protection setup. Spec §3. Generates the update key on this
 * device, locks copies of it (passkey or passphrase, plus the recovery
 * code), records them, then encrypts any existing updates right here.
 */
export function SetupFlow({
  member,
  onDone,
  onNeedsReload,
}: {
  member: GateMember
  /** Setup finished and the key is unlocked here: the parent should re-read the member's wraps. */
  onDone?: () => void
  /** Keys turned out to exist already (set up elsewhere meanwhile): the parent should re-read the wraps. */
  onNeedsReload?: () => void
}) {
  const router = useRouter()
  const [stage, setStage] = useState<"intro" | "passphrase" | "recovery" | "finishing" | "done">("intro")
  const [platformReady, setPlatformReady] = useState<boolean | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [confirm, setConfirm] = useState("")
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const uk = useRef<CryptoKey | null>(null)
  const wraps = useRef<WrapInput[]>([])

  // Is there a Face ID / fingerprint / Windows Hello authenticator here?
  useEffect(() => {
    let cancelled = false
    platformAuthenticatorAvailable().then((ok) => {
      if (!cancelled) setPlatformReady(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function ensureKey(): Promise<CryptoKey> {
    if (!uk.current) uk.current = await generateUpdateKey()
    return uk.current
  }

  async function toRecovery() {
    const { wrap, display } = await makeRecoveryWrap(await ensureKey())
    wraps.current = [...wraps.current.filter((w) => w.kind !== "recovery"), wrap]
    setRecoveryCode(display)
    setStage("recovery")
  }

  function startWithPasskey() {
    startTransition(async () => {
      try {
        const wrap = await makePasskeyWrap(await ensureKey(), member)
        if (!wrap) {
          toast.info(`${biometricLabel()} on this device can't protect updates yet (it lacks the passkey "PRF" feature) — set a passphrase instead. You can add other devices later.`, { duration: 15000 })
          setStage("passphrase")
          return
        }
        wraps.current = [wrap]
        await toRecovery()
      } catch (err) {
        toast.info(`${describePasskeyError(err)} You can also set a passphrase instead.`, { duration: 15000 })
      }
    })
  }

  function submitPassphrase(e: React.FormEvent) {
    e.preventDefault()
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      toast.error(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`)
      return
    }
    if (passphrase !== confirm) {
      toast.error("The two passphrases don't match.")
      return
    }
    startTransition(async () => {
      try {
        const wrap = await makePassphraseWrap(await ensureKey(), passphrase)
        wraps.current = [...wraps.current.filter((w) => w.kind !== "passphrase"), wrap]
        setPassphrase("")
        setConfirm("")
        await toRecovery()
      } catch {
        toast.error("Couldn't set the passphrase. Try again.")
      }
    })
  }

  function finish() {
    startTransition(async () => {
      const key = uk.current
      if (!key) return
      setStage("finishing")
      const res = await setupMemberKeys(wraps.current)
      if (!res.ok) {
        if (res.code === "already_set_up") {
          // Set up on another device meanwhile: this key (and code) are void.
          uk.current = null
          wraps.current = []
          setRecoveryCode(null)
          toast.info("Protection was already set up on another device. Unlock here instead.")
          onNeedsReload?.()
          router.refresh()
          return
        }
        if (res.code === "db_not_ready") {
          // The server undid the setup; this key and code are void. Back to the start.
          uk.current = null
          wraps.current = []
          setRecoveryCode(null)
          setStage("intro")
          toast.error(res.error, { duration: 20000 })
          return
        }
        toast.error(res.error)
        setStage("recovery")
        return
      }
      // Existing updates: encrypt them here (idempotent; the gate retries later if anything is left).
      let leftover = 0
      let reason: string | null = null
      try {
        const r = await sweepLegacyUpdates(member.id, key, res.keyId, (done, total) =>
          setProgress(`Protected ${done} of ${total} past update${total === 1 ? "" : "s"}…`)
        )
        leftover = r.remaining
        reason = r.reason
      } catch (err) {
        leftover = -1
        reason = err instanceof Error ? err.message : null
      }
      await adoptUnlockedKey(member.id, key, res.keyId)
      uk.current = null
      wraps.current = []
      setStage("done")
      if (leftover === 0) toast.success("Your updates are now protected.")
      else toast.error(`Protection is set up, but some past updates couldn't be protected yet${reason ? `: ${reason}` : "."} Open Me → Security to retry.`, { duration: 15000 })
      onDone?.()
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4" /> Protect your updates
        </CardTitle>
      </CardHeader>
      <CardContent>
        {stage === "intro" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              From now on your monthly updates are encrypted on your own device, so only you can read them — not the moderator, not {member.forumName}&apos;s admins, and not the people who run Cupcake. This takes a minute, once.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {platformReady !== false && (
                <Button type="button" className="gap-2" disabled={pending || platformReady === null} onClick={startWithPasskey}>
                  <Fingerprint className="size-4" /> {pending ? "Working…" : `Use ${biometricLabel()}`}
                </Button>
              )}
              <Button type="button" variant={platformReady === false ? "default" : "outline"} className="gap-2" disabled={pending} onClick={() => setStage("passphrase")}>
                <KeyRound className="size-4" /> {platformReady === false ? "Set a passphrase" : "Use a passphrase instead"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Either way you&apos;ll also get a recovery code to keep somewhere safe. Nothing you choose here is sent to Cupcake.
            </p>
          </div>
        )}

        {stage === "passphrase" && (
          <form onSubmit={submitPassphrase} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose a passphrase of at least {MIN_PASSPHRASE_LENGTH} characters. A few unrelated words work well. It never leaves this device.
            </p>
            <div className="space-y-2">
              <Label htmlFor="setup-passphrase">Passphrase</Label>
              <Input id="setup-passphrase" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} minLength={MIN_PASSPHRASE_LENGTH} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-confirm">Type it again</Label>
              <Input id="setup-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Working…" : "Continue"}
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setStage("intro")}>
                Back
              </Button>
            </div>
          </form>
        )}

        {stage === "recovery" && recoveryCode && (
          <RecoveryCodeCard code={recoveryCode} forumName={member.forumName} onAcknowledged={finish} acknowledging={pending} />
        )}

        {stage === "finishing" && (
          <p className="text-sm text-muted-foreground">{progress ?? "Finishing setup…"}</p>
        )}

        {stage === "done" && <p className="text-sm text-muted-foreground">Done. Loading your updates…</p>}
      </CardContent>
    </Card>
  )
}
