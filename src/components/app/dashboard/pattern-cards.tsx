"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import { UnlockGate, type GateMember } from "@/components/app/security/unlock-gate"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cardAad, decryptJson, encryptJson, updateAad } from "@/lib/crypto/content"
import { dismissPatternCard, savePatternCards } from "@/lib/ai/pattern-cards-actions"
import { updateContentSchema, type UpdateContent } from "@/lib/updates/schema"

type CardRow = { id: string; payload_enc: string; source_update_count: number; generated_at: string }
type RecentRow = { meetingId: string; envelope: string | null; legacy: unknown | null; completedAt: string | null }
type Card_ = { id: string; title: string; detail: string; topic_suggestion: string }

const MIN_UPDATES = 3

/**
 * "Patterns the AI noticed." Updates are end-to-end encrypted, so the
 * device does the work: it decrypts stored cards, or — when the member's
 * finalized count has moved on — decrypts their recent updates, asks the
 * server for new cards, and stores them encrypted. Nothing readable is
 * ever stored.
 */
export function PatternCardsClient(props: {
  member: GateMember
  finalizedCount: number
  cards: CardRow[]
  recent: RecentRow[]
  aiEnabled: boolean
}) {
  if (props.finalizedCount < MIN_UPDATES) return null
  return (
    <UnlockGate member={props.member} compact>
      {(key, keyId) => <Inner cryptoKey={key} keyId={keyId} {...props} />}
    </UnlockGate>
  )
}

async function openUpdate(key: CryptoKey, memberId: string, row: RecentRow): Promise<UpdateContent | null> {
  const raw = row.envelope ? await decryptJson(key, row.envelope, updateAad(memberId, row.meetingId)) : row.legacy
  const parsed = updateContentSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

function Inner({ cryptoKey, keyId, member, finalizedCount, cards, recent, aiEnabled }: { cryptoKey: CryptoKey; keyId: string } & Parameters<typeof PatternCardsClient>[0]) {
  const [shown, setShown] = useState<Card_[] | null>(null)
  const attempted = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const fresh = cards.filter((c) => c.source_update_count === finalizedCount)
      if (fresh.length > 0) {
        const out: Card_[] = []
        for (const c of fresh) {
          try {
            const p = (await decryptJson(cryptoKey, c.payload_enc, cardAad(member.id, c.id))) as Omit<Card_, "id">
            out.push({ id: c.id, ...p })
          } catch {
            // A card that won't open is simply not shown.
          }
        }
        if (!cancelled) setShown(out)
        return
      }
      if (!aiEnabled || attempted.current || recent.length < MIN_UPDATES) {
        if (!cancelled) setShown([])
        return
      }
      attempted.current = true
      try {
        const opened: { content: UpdateContent; date: string }[] = []
        for (const row of recent) {
          const content = await openUpdate(cryptoKey, member.id, row)
          if (content) opened.push({ content, date: row.completedAt?.slice(0, 10) ?? "" })
        }
        if (opened.length < MIN_UPDATES) {
          if (!cancelled) setShown([])
          return
        }
        opened.reverse() // oldest first for the prompt
        const res = await fetch("/api/patterns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: opened.map((o) => o.content), dates: opened.map((o) => o.date) }),
        })
        const body = (await res.json()) as { ok: boolean; cards?: Omit<Card_, "id">[]; error?: string }
        if (!body.ok || !body.cards) {
          if (!cancelled) setShown([])
          return
        }
        const withIds: Card_[] = body.cards.map((c) => ({ id: crypto.randomUUID(), ...c }))
        const encrypted = []
        for (const c of withIds) {
          const { id, ...payload } = c
          encrypted.push({ id, payloadEnc: await encryptJson(cryptoKey, payload, cardAad(member.id, id)) })
        }
        const saved = await savePatternCards({ sourceUpdateCount: finalizedCount, keyId, cards: encrypted })
        if (!cancelled) setShown(saved.ok ? withIds : [])
      } catch {
        if (!cancelled) setShown([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cryptoKey, keyId, member.id, finalizedCount, cards, recent, aiEnabled])

  async function dismiss(id: string) {
    setShown((s) => (s ?? []).filter((c) => c.id !== id))
    const res = await dismissPatternCard(id)
    if (!res.ok) toast.error(res.error)
  }

  if (!shown || shown.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="font-heading text-sm font-semibold flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-muted-foreground" />
        Patterns the AI noticed
      </h2>
      <div className="grid gap-2">
        {shown.map((c) => (
          <Card key={c.id} className="border-dashed">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium leading-snug">{c.title}</CardTitle>
              <Button type="button" size="sm" variant="ghost" className="size-7 -my-1 -mr-2 px-1" title="Dismiss" onClick={() => dismiss(c.id)}>
                <X className="size-3" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{c.detail}</p>
              {c.topic_suggestion && (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/forum/parking-lot/new?topic=${encodeURIComponent(c.topic_suggestion)}`} />}
                >
                  Park &ldquo;{c.topic_suggestion}&rdquo;
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
