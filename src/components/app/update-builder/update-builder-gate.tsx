"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { UnlockGate, type GateMember } from "@/components/app/security/unlock-gate"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { decryptJson, EnvelopeError, updateAad } from "@/lib/crypto/content"
import { emptyUpdateContent, updateContentSchema, type UpdateContent } from "@/lib/updates/schema"
import type { ExplorationFormat } from "@/lib/types/domain"

import { UpdateBuilder } from "./update-builder"

export type EncryptedUpdateRow = {
  meetingId: string
  /** The device-encrypted envelope, or null for a row not yet migrated. */
  envelope: string | null
  /** Readable content for a not-yet-migrated row (the member's own; encrypted on next save). */
  legacy: unknown | null
}

type Props = {
  member: GateMember
  meetingId: string
  meetingLabel: string
  current: EncryptedUpdateRow | null
  initialReady: boolean
  formats: ExplorationFormat[]
  qolHistory: Array<Record<string, number>>
  /** Recent finalized updates (newest first), for AI calibration. */
  recent: EncryptedUpdateRow[]
  naturalVoice?: boolean
}

/** Unlock, decrypt what the builder needs, then hand over. */
export function UpdateBuilderGate(props: Props) {
  return (
    <UnlockGate member={props.member}>
      {(key, keyId) => <Decrypted key={props.meetingId} cryptoKey={key} keyId={keyId} {...props} />}
    </UnlockGate>
  )
}

async function open(key: CryptoKey, memberId: string, row: EncryptedUpdateRow | null): Promise<UpdateContent | null> {
  if (!row) return null
  if (row.envelope) {
    const parsed = updateContentSchema.safeParse(await decryptJson(key, row.envelope, updateAad(memberId, row.meetingId)))
    return parsed.success ? parsed.data : null
  }
  if (row.legacy) {
    const parsed = updateContentSchema.safeParse(row.legacy)
    return parsed.success ? parsed.data : null
  }
  return null
}

function Decrypted({ cryptoKey, keyId, member, meetingId, meetingLabel, current, initialReady, formats, qolHistory, recent, naturalVoice }: Props & { cryptoKey: CryptoKey; keyId: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; initialContent: UpdateContent; history: UpdateContent[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const initialContent = (await open(cryptoKey, member.id, current)) ?? emptyUpdateContent
        const history: UpdateContent[] = []
        for (const row of recent.slice(0, 3)) {
          try {
            const c = await open(cryptoKey, member.id, row)
            if (c) history.push(c)
          } catch {
            // A past update that won't open is skipped for AI context; it isn't blocking.
          }
        }
        if (!cancelled) setState({ kind: "ready", initialContent, history })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof EnvelopeError
                ? "This update can't be opened with the key on this device. Lock and unlock again under Me → Security; if you started fresh since it was written, it can't be recovered."
                : "Couldn't open your update on this device.",
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cryptoKey, member.id, current, recent])

  if (state.kind === "loading") {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Opening your update…</CardContent>
      </Card>
    )
  }
  if (state.kind === "error") {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center text-sm text-muted-foreground">
          <p>{state.message}</p>
          <Button size="sm" variant="outline" render={<Link href="/me/security" />}>
            Security settings
          </Button>
        </CardContent>
      </Card>
    )
  }
  return (
    <UpdateBuilder
      meetingId={meetingId}
      meetingLabel={meetingLabel}
      memberId={member.id}
      cryptoKey={cryptoKey}
      keyId={keyId}
      initialContent={state.initialContent}
      initialReady={initialReady}
      formats={formats}
      qolHistory={qolHistory}
      history={state.history}
      naturalVoice={naturalVoice}
    />
  )
}
