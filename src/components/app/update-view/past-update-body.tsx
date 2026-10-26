"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { UnlockGate, type GateMember } from "@/components/app/security/unlock-gate"
import { UpdateExportButtons } from "@/components/app/update-pdf/export-buttons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { decryptJson, EnvelopeError, updateAad } from "@/lib/crypto/content"
import type { UpdateExportMeta } from "@/lib/updates/export-meta"
import { parseStoredUpdate, type UpdateContent } from "@/lib/updates/schema"

type Props = {
  member: GateMember
  meetingId: string
  envelope: string | null
  legacy: unknown | null
  meta: UpdateExportMeta
}

/** A past update, decrypted and rendered on the device. */
export function PastUpdateBody(props: Props) {
  return (
    <UnlockGate member={props.member}>{(key) => <Opened cryptoKey={key} {...props} />}</UnlockGate>
  )
}

export function useOpenedUpdate(cryptoKey: CryptoKey, memberId: string, meetingId: string, envelope: string | null, legacy: unknown | null) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; content: UpdateContent } | { kind: "error"; message: string }>({ kind: "loading" })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!envelope && !legacy) {
          if (!cancelled) setState({ kind: "error", message: "This update's content was cleared when you started fresh. Its Quality of Life scores were kept." })
          return
        }
        const raw = envelope ? await decryptJson(cryptoKey, envelope, updateAad(memberId, meetingId)) : legacy
        const parsed = parseStoredUpdate(raw)
        if (!parsed) throw new Error("bad shape")
        if (!cancelled) setState({ kind: "ok", content: parsed })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof EnvelopeError
                ? "This update can't be opened with the key on this device. Lock and unlock again under Me → Security; if you started fresh since it was written, it can't be recovered."
                : "Couldn't open this update.",
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cryptoKey, memberId, meetingId, envelope, legacy])
  return state
}

function Opened({ cryptoKey, member, meetingId, envelope, legacy, meta }: Props & { cryptoKey: CryptoKey }) {
  const state = useOpenedUpdate(cryptoKey, member.id, meetingId, envelope, legacy)
  if (state.kind === "loading") {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Opening…</CardContent>
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
  const content = state.content
  const formatLabel = meta.formatLabels[content.topic.exploration_format] ?? content.topic.exploration_format

  return (
    <div className="space-y-4">
      <UpdateExportButtons meetingId={meetingId} content={content} meta={meta} />

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Quality of Life</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["physical_health", "Physical"],
              ["mental_health", "Mental"],
              ["financial_health", "Financial"],
              ["friends_community", "Community"],
            ] as const
          ).map(([key, label]) => (
            <Card key={key}>
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-heading text-2xl font-semibold">
                  {content.qol[key]}
                  <span className="text-sm text-muted-foreground"> / 10</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {(["business", "family", "personal"] as const).map((section) => (
        <ReflectionSection key={section} title={section.charAt(0).toUpperCase() + section.slice(1)} data={content[section]} />
      ))}

      <Separator />

      <SimpleField title="Most important thing coming up" body={content.coming_up.text} chips={content.coming_up.feelings} />
      <SimpleField title="One energy vampire" body={content.energy_vampire} />
      <SimpleField
        title="One goal"
        body={content.goal.text}
        meta={content.goal.text ? `${content.goal.horizon}${content.goal.make_commitment ? " · Forum commitment" : ""}` : null}
      />

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">Topic to present</h2>
        <Card>
          <CardContent className="space-y-2 py-3 text-sm">
            <p>{content.topic.text || <span className="text-muted-foreground">—</span>}</p>
            {content.topic.publish_to_parking_lot && content.topic.text && (
              <p className="text-xs text-muted-foreground">
                Published to Parking Lot · {content.topic.tool_category} · {formatLabel}
              </p>
            )}
            {content.topic.context && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{content.topic.context}</p>}
          </CardContent>
        </Card>
      </section>

      <p className="pt-4 text-xs text-muted-foreground">
        Encrypted so only you can read it — except your Quality of Life numbers, which forum leadership can see in QOL History.
      </p>
    </div>
  )
}

function ReflectionSection({ title, data }: { title: string; data: UpdateContent["business"] }) {
  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      <Card>
        <CardContent className="space-y-3 py-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feelings</p>
            {data.feelings.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {data.feelings.map((f, i) => (
                  <Badge key={i} variant="outline">
                    {f}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">—</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Situation</p>
            <p className="whitespace-pre-wrap">{data.situation || <span className="text-muted-foreground">—</span>}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Significance</p>
            {data.significance.map((s, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-2">
                <span className="text-xs text-muted-foreground">Layer {i + 1}</span>
                <p className="whitespace-pre-wrap">{s || <span className="text-muted-foreground">—</span>}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function SimpleField({ title, body, chips, meta }: { title: string; body: string; chips?: string[]; meta?: string | null }) {
  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      <Card>
        <CardContent className="space-y-2 py-3 text-sm">
          <p className="whitespace-pre-wrap">{body || <span className="text-muted-foreground">—</span>}</p>
          {chips && chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map((c, i) => (
                <Badge key={i} variant="outline">
                  {c}
                </Badge>
              ))}
            </div>
          )}
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </CardContent>
      </Card>
    </section>
  )
}
