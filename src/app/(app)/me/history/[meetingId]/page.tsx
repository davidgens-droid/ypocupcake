import Link from "next/link"
import { format, parseISO } from "date-fns"
import { ChevronLeft, FileDown } from "lucide-react"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"

type Params = Promise<{ meetingId: string }>

export default async function PastUpdatePage({
  params,
}: {
  params: Params
}) {
  const me = await requireCurrentMember()
  const { meetingId } = await params
  const supabase = await createClient()

  const [{ data: meeting }, { data: update }, { data: formats }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("id, scheduled_at, location")
        .eq("id", meetingId)
        .maybeSingle(),
      supabase
        .from("updates")
        .select("content, ready, completed_at, updated_at")
        .eq("meeting_id", meetingId)
        .eq("member_id", me.id)
        .maybeSingle(),
      supabase
        .from("exploration_formats")
        .select("code, display_name, default_minutes"),
    ])

  if (!meeting) notFound()
  if (!update) notFound()

  let content: UpdateContent = emptyUpdateContent
  if (update.content) {
    const parsed = updateContentSchema.safeParse(update.content)
    if (parsed.success) content = parsed.data
  }

  const formatLabel = new Map(
    (formats ?? []).map((f) => [
      f.code,
      `${f.display_name} · ${f.default_minutes}m`,
    ])
  )

  const status = update.completed_at
    ? update.ready
      ? "Ready"
      : "Finalized"
    : "Draft"

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" render={<Link href="/me/history" />}>
          <ChevronLeft className="size-4" /> Past updates
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={
            <Link href={`/print/update/${meeting.id}`} target="_blank" />
          }
        >
          <FileDown className="size-4" /> Print / PDF
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {formatMeeting(meeting.scheduled_at, "EEE MMM d, yyyy")}
        </h1>
        <p className="text-sm text-muted-foreground">
          📍 {meeting.location ?? "TBD"} ·{" "}
          <Badge variant={status === "Draft" ? "outline" : "default"}>
            {status}
          </Badge>
          {update.completed_at && (
            <>
              {" · finalized "}
              {format(parseISO(update.completed_at), "MMM d, yyyy")}
            </>
          )}
        </p>
      </header>

      {/* Quality of Life */}
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
        <ReflectionSection
          key={section}
          title={section.charAt(0).toUpperCase() + section.slice(1)}
          data={content[section]}
        />
      ))}

      <Separator />

      <SimpleField
        title="Most important thing coming up"
        body={content.coming_up.text}
        chips={content.coming_up.feelings}
      />

      <SimpleField
        title="One energy vampire"
        body={content.energy_vampire}
      />

      <SimpleField
        title="One goal"
        body={content.goal.text}
        meta={
          content.goal.text
            ? `${content.goal.horizon}${content.goal.make_commitment ? " · Forum commitment" : ""}`
            : null
        }
      />

      <section className="space-y-2">
        <h2 className="font-heading text-base font-semibold">
          Topic to present
        </h2>
        <Card>
          <CardContent className="space-y-2 py-3 text-sm">
            <p>
              {content.topic.text || (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            {content.topic.publish_to_parking_lot && content.topic.text && (
              <p className="text-xs text-muted-foreground">
                Published to Parking Lot · {content.topic.tool_category} ·{" "}
                {formatLabel.get(content.topic.exploration_format) ??
                  content.topic.exploration_format}
              </p>
            )}
            {content.topic.context && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {content.topic.context}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <p className="pt-4 text-xs text-muted-foreground">
        Private to you. Last edited{" "}
        {format(parseISO(update.updated_at), "MMM d, yyyy 'at' h:mm a")}.
      </p>
    </div>
  )
}

type Reflection = {
  feelings: string[]
  situation: string
  significance: [string, string, string]
}

function ReflectionSection({
  title,
  data,
}: {
  title: string
  data: Reflection
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      <Card>
        <CardContent className="space-y-3 py-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Feelings
            </p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Situation
            </p>
            <p className="whitespace-pre-wrap">
              {data.situation || (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Significance
            </p>
            {data.significance.map((s, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-2">
                <span className="text-xs text-muted-foreground">
                  Layer {i + 1}
                </span>
                <p className="whitespace-pre-wrap">
                  {s || <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function SimpleField({
  title,
  body,
  chips,
  meta,
}: {
  title: string
  body: string
  chips?: string[]
  meta?: string | null
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      <Card>
        <CardContent className="space-y-2 py-3 text-sm">
          <p className="whitespace-pre-wrap">
            {body || <span className="text-muted-foreground">—</span>}
          </p>
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
