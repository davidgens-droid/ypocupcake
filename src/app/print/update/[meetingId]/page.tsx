import { format, parseISO } from "date-fns"
import { notFound } from "next/navigation"

import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"
import { FORMAT_PHASES } from "@/lib/meetings/exploration-phases"
import type { ExplorationFormatCode } from "@/lib/types/domain"

type Params = Promise<{ meetingId: string }>

export const metadata = {
  title: "Cupcake — Update",
}

const STYLES = `
  .print-page { font-family: Arial, Helvetica, sans-serif; color: #000; max-width: 720px; margin: 32px auto; padding: 0 24px; line-height: 1.45; font-size: 13px; }
  .print-page h1 { font-size: 22px; margin: 0 0 4px 0; }
  .print-page h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #ccc; color: #444; }
  .print-page h3 { font-size: 12px; font-weight: 700; margin: 14px 0 4px 0; }
  .print-page p { margin: 4px 0; }
  .print-page .muted { color: #666; }
  .print-page .meta { font-size: 11px; color: #666; margin-bottom: 16px; }
  .print-page .qol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0 0; }
  .print-page .qol-cell { border: 1px solid #ddd; padding: 6px 8px; }
  .print-page .qol-cell .num { font-size: 18px; font-weight: 700; }
  .print-page .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
  .print-page .chip { border: 1px solid #999; padding: 1px 6px; font-size: 11px; border-radius: 8px; }
  .print-page .layer { margin: 4px 0; }
  .print-page .layer .label { font-weight: 600; font-size: 10px; text-transform: uppercase; color: #666; margin-right: 6px; }
  .print-page .ready-badge { display: inline-block; background: #ecfdf5; border: 1px solid #34d399; color: #065f46; padding: 1px 6px; font-size: 10px; border-radius: 4px; margin-left: 8px; }
  .print-page .private { font-size: 10px; color: #888; margin-top: 24px; padding-top: 8px; border-top: 1px dashed #ccc; }
  .print-controls { position: fixed; top: 12px; right: 12px; z-index: 50; }
  .print-controls button { padding: 6px 12px; font-size: 13px; border: 1px solid #444; background: #fff; cursor: pointer; }
  @media print {
    body > nav, body > header, body > footer, .print-controls { display: none !important; }
    .print-page { margin: 0; padding: 14mm 18mm; max-width: none; font-size: 11pt; }
    .print-page h2 { break-after: avoid; }
  }
`

export default async function PrintUpdatePage({
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
        .select("content, ready, completed_at")
        .eq("meeting_id", meetingId)
        .eq("member_id", me.id)
        .maybeSingle(),
      supabase
        .from("exploration_formats")
        .select("code, display_name, default_minutes"),
    ])

  if (!meeting) notFound()

  let content: UpdateContent = emptyUpdateContent
  if (update?.content) {
    const parsed = updateContentSchema.safeParse(update.content)
    if (parsed.success) content = parsed.data
  }

  const formatLabel = new Map(
    (formats ?? []).map((f) => [
      f.code,
      `${f.display_name} · ${f.default_minutes}m`,
    ])
  )

  const meetingDate = formatMeeting(meeting.scheduled_at, "EEE, MMM d, yyyy")

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="print-controls">
        <button type="button" data-print-button>
          Print / Save as PDF
        </button>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.querySelector('[data-print-button]')?.addEventListener('click',()=>window.print());window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='p'){e.preventDefault();window.print();}});",
        }}
      />

      <article className="print-page">
        <h1>YPO Update — {me.name}</h1>
        <div className="meta">
          {meetingDate}
          {meeting.location ? ` · ${meeting.location}` : ""}
          {update?.completed_at && (
            <>
              {" · finalized "}
              {format(parseISO(update.completed_at), "MMM d, yyyy")}
            </>
          )}
          {update?.ready && <span className="ready-badge">READY</span>}
        </div>

        <h2>Forum 5% Reflection</h2>
        <p className="muted">
          3–5 quality words to describe feelings · Situation: one sentence ·
          5/5/90 Rule
        </p>

        <h2>Quality of Life</h2>
        <div className="qol">
          {(
            [
              ["physical_health", "Physical Health"],
              ["mental_health", "Mental Health"],
              ["financial_health", "Financial Health"],
              ["friends_community", "Friends / Community"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="qol-cell">
              <div className="muted" style={{ fontSize: 10 }}>
                {label}
              </div>
              <div className="num">{content.qol[key]}</div>
            </div>
          ))}
        </div>

        {(["business", "family", "personal"] as const).map((section) => (
          <section key={section}>
            <h2>{section.charAt(0).toUpperCase() + section.slice(1)}</h2>
            <h3>Feelings</h3>
            <div className="chips">
              {content[section].feelings.length > 0 ? (
                content[section].feelings.map((f, i) => (
                  <span key={i} className="chip">
                    {f}
                  </span>
                ))
              ) : (
                <span className="muted">—</span>
              )}
            </div>
            <h3>Situation</h3>
            <p>
              {content[section].situation || (
                <span className="muted">—</span>
              )}
            </p>
            <h3>Significance</h3>
            {content[section].significance.map((s, i) => (
              <div key={i} className="layer">
                <span className="label">Layer {i + 1}</span>
                {s || <span className="muted">—</span>}
              </div>
            ))}
          </section>
        ))}

        <h2>Most important thing coming up</h2>
        <p>
          {content.coming_up.text || <span className="muted">—</span>}
        </p>
        {content.coming_up.feelings.length > 0 && (
          <div className="chips">
            {content.coming_up.feelings.map((f, i) => (
              <span key={i} className="chip">
                {f}
              </span>
            ))}
          </div>
        )}

        <h2>One energy vampire</h2>
        <p>
          {content.energy_vampire || <span className="muted">—</span>}
        </p>

        <h2>One goal</h2>
        <p>
          {content.goal.text || <span className="muted">—</span>}
          {content.goal.text && (
            <span className="muted"> · {content.goal.horizon}</span>
          )}
          {content.goal.make_commitment && (
            <span className="ready-badge">FORUM COMMITMENT</span>
          )}
        </p>

        <h2>Topic to present</h2>
        <p>{content.topic.text || <span className="muted">—</span>}</p>
        {content.topic.publish_to_parking_lot && content.topic.text && (
          <p className="muted">
            Published to Parking Lot · {content.topic.tool_category} ·{" "}
            {formatLabel.get(content.topic.exploration_format) ??
              content.topic.exploration_format}
          </p>
        )}
        {content.topic.publish_to_parking_lot &&
          content.topic.exploration_format && (
            <PhaseList
              format={content.topic.exploration_format as ExplorationFormatCode}
            />
          )}

        <p className="private">
          This document is private to {me.name} — except the Quality of Life
          numbers, which forum leadership can see in QOL History. Generated by
          Cupcake.
        </p>
      </article>
    </>
  )
}

function PhaseList({ format }: { format: ExplorationFormatCode }) {
  const phases = FORMAT_PHASES[format]
  if (!phases) return null
  return (
    <div className="muted" style={{ fontSize: 11 }}>
      Phases:{" "}
      {phases
        .map((p, i) => `${i + 1}. ${p.name} (${p.default_seconds / 60}m)`)
        .join(" · ")}
    </div>
  )
}
