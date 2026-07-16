"use server"

import { format, parseISO } from "date-fns"

import { formatMeeting } from "@/lib/dates"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  updateContentSchema,
  type UpdateContent,
} from "@/lib/updates/schema"
import type { ExplorationFormatCode } from "@/lib/types/domain"

export async function emailUpdateToSelf(input: { meetingId: string }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return {
      ok: false as const,
      error: "Email is not configured (missing RESEND_API_KEY).",
    }
  }

  const me = await requireCurrentMember()
  const supabase = await createClient()

  const [{ data: meeting }, { data: update }, { data: formats }] =
    await Promise.all([
      supabase
        .from("meetings")
        .select("scheduled_at, location")
        .eq("id", input.meetingId)
        .maybeSingle(),
      supabase
        .from("updates")
        .select("content, ready, completed_at")
        .eq("meeting_id", input.meetingId)
        .eq("member_id", me.id)
        .maybeSingle(),
      supabase
        .from("exploration_formats")
        .select("code, display_name, default_minutes"),
    ])

  if (!meeting) {
    return { ok: false as const, error: "Meeting not found." }
  }

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
  const subject = `Your Cupcake update — ${meetingDate}`
  const html = renderHtml({
    name: me.name,
    meetingDate,
    location: meeting.location,
    completedAt: update?.completed_at ?? null,
    ready: update?.ready ?? false,
    content,
    formatLabel,
  })

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Cupcake <${process.env.RESEND_FROM_EMAIL}>`,
        to: [me.email],
        subject,
        html,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      const message =
        (body && typeof body.message === "string" && body.message) ||
        `Resend returned ${res.status}`
      return { ok: false as const, error: message }
    }

    return { ok: true as const }
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Email send failed.",
    }
  }
}

// ─── HTML renderer (inline styles only — email clients strip <style>) ──────
function renderHtml(args: {
  name: string
  meetingDate: string
  location: string | null
  completedAt: string | null
  ready: boolean
  content: UpdateContent
  formatLabel: Map<string, string>
}) {
  const { name, meetingDate, location, completedAt, ready, content, formatLabel } = args

  const sFamily = "font-family:Arial,Helvetica,sans-serif"
  const sBody = `${sFamily};color:#000;font-size:13px;line-height:1.45;max-width:640px;margin:0 auto;padding:24px;`
  const sH2 = `${sFamily};font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:24px 0 8px 0;padding-bottom:4px;border-bottom:1px solid #ccc;color:#444;`
  const sH3 = `${sFamily};font-size:12px;font-weight:700;margin:14px 0 4px 0;`
  const sP = `${sFamily};margin:4px 0;`
  const sMuted = `color:#666;`
  const sChip = `display:inline-block;border:1px solid #999;padding:1px 6px;font-size:11px;border-radius:8px;margin:0 4px 4px 0;`
  const sBadge = `display:inline-block;background:#ecfdf5;border:1px solid #34d399;color:#065f46;padding:1px 6px;font-size:10px;border-radius:4px;margin-left:8px;`
  const dash = `<span style="${sMuted}">—</span>`
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")

  const chips = (arr: string[]) =>
    arr.length === 0
      ? dash
      : arr.map((c) => `<span style="${sChip}">${escape(c)}</span>`).join("")

  const qolCells = (
    [
      ["physical_health", "Physical Health"],
      ["mental_health", "Mental Health"],
      ["financial_health", "Financial Health"],
      ["friends_community", "Friends / Community"],
    ] as const
  )
    .map(
      ([key, label]) =>
        `<td style="border:1px solid #ddd;padding:8px 10px;width:25%;">
          <div style="${sMuted};font-size:10px;">${label}</div>
          <div style="font-size:18px;font-weight:700;">${content.qol[key]}</div>
        </td>`
    )
    .join("")

  const sectionHtml = (label: string, key: "business" | "family" | "personal") => {
    const sec = content[key]
    return `
      <h2 style="${sH2}">${label}</h2>
      <h3 style="${sH3}">Feelings</h3>
      <p style="${sP}">${chips(sec.feelings)}</p>
      <h3 style="${sH3}">Situation</h3>
      <p style="${sP}">${sec.situation ? escape(sec.situation) : dash}</p>
      <h3 style="${sH3}">Significance</h3>
      ${sec.significance
        .map(
          (s, i) => `
        <p style="${sP}">
          <span style="font-weight:600;font-size:10px;text-transform:uppercase;${sMuted};margin-right:6px;">Layer ${i + 1}</span>
          ${s ? escape(s) : dash}
        </p>`
        )
        .join("")}
    `
  }

  const explorationLabel =
    formatLabel.get(content.topic.exploration_format) ??
    content.topic.exploration_format

  return `<!doctype html>
<html>
<body style="${sBody}">
  <h1 style="${sFamily};font-size:22px;margin:0 0 4px 0;">YPO Update — ${escape(name)}</h1>
  <div style="${sFamily};font-size:11px;${sMuted};margin-bottom:16px;">
    ${meetingDate}
    ${location ? ` · ${escape(location)}` : ""}
    ${completedAt ? ` · finalized ${format(parseISO(completedAt), "MMM d, yyyy")}` : ""}
    ${ready ? `<span style="${sBadge}">READY</span>` : ""}
  </div>

  <h2 style="${sH2}">Forum 5% Reflection</h2>
  <p style="${sP};${sMuted}">3–5 quality words to describe feelings · Situation: one sentence · 5/5/90 Rule</p>

  <h2 style="${sH2}">Quality of Life</h2>
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin-top:8px;">
    <tr>${qolCells}</tr>
  </table>

  ${sectionHtml("Business", "business")}
  ${sectionHtml("Family", "family")}
  ${sectionHtml("Personal", "personal")}

  <h2 style="${sH2}">Most important thing coming up</h2>
  <p style="${sP}">${content.coming_up.text ? escape(content.coming_up.text) : dash}</p>
  ${content.coming_up.feelings.length > 0 ? `<p style="${sP}">${chips(content.coming_up.feelings)}</p>` : ""}

  <h2 style="${sH2}">One energy vampire</h2>
  <p style="${sP}">${content.energy_vampire ? escape(content.energy_vampire) : dash}</p>

  <h2 style="${sH2}">One goal</h2>
  <p style="${sP}">
    ${content.goal.text ? escape(content.goal.text) : dash}
    ${content.goal.text ? `<span style="${sMuted}"> · ${content.goal.horizon}</span>` : ""}
    ${content.goal.make_commitment ? `<span style="${sBadge}">FORUM COMMITMENT</span>` : ""}
  </p>

  <h2 style="${sH2}">Topic to present</h2>
  <p style="${sP}">${content.topic.text ? escape(content.topic.text) : dash}</p>
  ${
    content.topic.publish_to_parking_lot && content.topic.text
      ? `<p style="${sP};${sMuted}">Published to Parking Lot · ${content.topic.tool_category} · ${escape(explorationLabel)}</p>`
      : ""
  }

  <p style="${sFamily};font-size:10px;${sMuted};margin-top:24px;padding-top:8px;border-top:1px dashed #ccc;">
    This document is private to ${escape(name)} — except the Quality of Life
    numbers, which forum leadership can see in QOL History. Generated by Cupcake.
  </p>
</body>
</html>`
}
