"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { Card, CardContent } from "@/components/ui/card"
import { getKeySnapshot, lockKey, restoreKey, subscribeKey, type KeySnapshot } from "@/lib/crypto/session"
import { getMyKeyWraps, type KeyWrap } from "@/lib/security/actions"

import { SetupFlow } from "./setup-flow"
import { sweepLegacyUpdates } from "./unlock-core"
import { UnlockPanel } from "./unlock-panel"

export type GateMember = { id: string; email: string; name: string; forumName: string }

type Props = {
  member: GateMember
  /** Rendered only with the member's unlocked update key and that key's id. */
  children: (key: CryptoKey, keyId: string) => React.ReactNode
  /** A smaller inline prompt (dashboard cards) instead of the full-width panel. */
  compact?: boolean
}

const SERVER_SNAPSHOT: KeySnapshot = { memberId: null, key: null, keyId: null, checked: false }
const getServerSnapshot = () => SERVER_SNAPSHOT

/**
 * Wraps anything that needs decrypted updates. Three states: no keys yet →
 * the one-time setup; keys but locked on this device → unlock; unlocked →
 * children with the key. A cached key is trusted only if its id still
 * matches the member's current key (a "Start fresh" elsewhere retires it).
 * After every unlock, any still-readable past updates are swept into
 * envelopes.
 */
export function UnlockGate({ member, children, compact = false }: Props) {
  const snap = useSyncExternalStore(subscribeKey, getKeySnapshot, getServerSnapshot)
  const [wraps, setWraps] = useState<KeyWrap[] | null>(null)
  const [reload, setReload] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const swept = useRef<string | null>(null)

  const unlocked = snap.checked && snap.memberId === member.id && !!snap.key && !!snap.keyId

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cached = await restoreKey(member.id)
        const w = await getMyKeyWraps()
        if (cancelled) return
        if (cached && !w.some((x) => x.key_id === cached.keyId)) {
          // Retired key (Start fresh on another device): never trust it.
          await lockKey(member.id)
          toast.info("Your update protection was reset on another device. Unlock again here.")
        }
        setWraps(w)
      } catch {
        if (!cancelled) setLoadError("Couldn't load your protection settings. Reload to try again.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [member.id, reload])

  // Once unlocked, protect anything still readable (idempotent, once per key per mount).
  useEffect(() => {
    if (!unlocked || !snap.key || !snap.keyId || swept.current === snap.keyId) return
    swept.current = snap.keyId
    const key = snap.key
    const keyId = snap.keyId
    sweepLegacyUpdates(member.id, key, keyId).then((r) => {
      if (r.total > 0 && r.remaining === 0) toast.success(`${r.total} past update${r.total === 1 ? "" : "s"} protected.`)
      if (r.remaining > 0) toast.error(`${r.remaining} past update${r.remaining === 1 ? "" : "s"} couldn't be protected yet. Retry from Me → Security.`)
    }).catch(() => {})
  }, [unlocked, snap.key, snap.keyId, member.id])

  if (unlocked && snap.key && snap.keyId) return <>{children(snap.key, snap.keyId)}</>

  if (loadError) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">{loadError}</CardContent>
      </Card>
    )
  }
  if (!snap.checked || wraps === null) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Checking your protection…</CardContent>
      </Card>
    )
  }
  if (wraps.length === 0) return <SetupFlow member={member} onNeedsReload={() => setReload((n) => n + 1)} />
  return <UnlockPanel member={member} wraps={wraps} compact={compact} />
}
