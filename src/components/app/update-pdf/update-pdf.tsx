"use client"

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import type { UpdateContent } from "@/lib/updates/schema"
import { FORMAT_PHASES } from "@/lib/meetings/exploration-phases"
import type { ExplorationFormatCode } from "@/lib/types/domain"
import type { UpdateExportMeta } from "@/lib/updates/export-meta"

/**
 * The update as a real PDF (selectable text), mirroring the print view.
 * Rendered entirely on the device from decrypted content; loaded lazily by
 * the Save-as-PDF button so the renderer never ships with the main bundle.
 */

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 48, paddingHorizontal: 52, fontSize: 10.5, fontFamily: "Helvetica", color: "#000", lineHeight: 1.45 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  meta: { fontSize: 9, color: "#666", marginBottom: 14 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8, color: "#444", marginTop: 16, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: "#ccc" },
  h3: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 2 },
  p: { marginVertical: 2 },
  muted: { color: "#666" },
  chips: { flexDirection: "row", flexWrap: "wrap", marginVertical: 2 },
  chip: { borderWidth: 1, borderColor: "#999", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, fontSize: 9, marginRight: 4, marginBottom: 4 },
  qol: { flexDirection: "row", marginTop: 6 },
  qolCell: { flex: 1, borderWidth: 1, borderColor: "#ddd", padding: 6, marginRight: 6 },
  qolLabel: { fontSize: 8, color: "#666" },
  qolNum: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  layer: { flexDirection: "row", marginVertical: 2 },
  layerLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", textTransform: "uppercase", color: "#666", width: 44, marginTop: 2 },
  badge: { fontSize: 8, color: "#065f46", backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#34d399", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 6 },
  footer: { position: "absolute", bottom: 24, left: 52, right: 52, fontSize: 8, color: "#888", borderTopWidth: 1, borderTopColor: "#ccc", borderTopStyle: "dashed", paddingTop: 6 },
})

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <Text style={s.muted}>—</Text>
  return (
    <View style={s.chips}>
      {items.map((c, i) => (
        <Text key={i} style={s.chip}>
          {c}
        </Text>
      ))}
    </View>
  )
}

function Section({ title, data }: { title: string; data: UpdateContent["business"] }) {
  return (
    <View wrap={false}>
      <Text style={s.h2}>{title}</Text>
      <Text style={s.h3}>Feelings</Text>
      <Chips items={data.feelings} />
      <Text style={s.h3}>Situation</Text>
      <Text style={s.p}>{data.situation || "—"}</Text>
      <Text style={s.h3}>Significance</Text>
      {data.significance.map((layer, i) => (
        <View key={i} style={s.layer}>
          <Text style={s.layerLabel}>Layer {i + 1}</Text>
          <Text style={{ flex: 1 }}>{layer || "—"}</Text>
        </View>
      ))}
    </View>
  )
}

export function UpdatePdf({ content, meta, finalizedLabel }: { content: UpdateContent; meta: UpdateExportMeta; finalizedLabel: string | null }) {
  const formatLabel = meta.formatLabels[content.topic.exploration_format] ?? content.topic.exploration_format
  const phases = FORMAT_PHASES[content.topic.exploration_format as ExplorationFormatCode]
  return (
    <Document title={`YPO Update — ${meta.memberName}`} author={meta.memberName} producer="Cupcake" creator="Cupcake">
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>YPO Update — {meta.memberName}</Text>
        <Text style={s.meta}>
          {meta.forumName} · {meta.meetingDate}
          {meta.location ? ` · ${meta.location}` : ""}
          {finalizedLabel ? ` · finalized ${finalizedLabel}` : ""}
          {meta.ready ? "   READY" : ""}
        </Text>

        <Text style={s.h2}>Forum 5% Reflection</Text>
        <Text style={[s.p, s.muted]}>3–5 quality words to describe feelings · Situation: one sentence · 5/5/90 Rule</Text>

        <Text style={s.h2}>Quality of Life</Text>
        <View style={s.qol}>
          {(
            [
              ["physical_health", "Physical Health"],
              ["mental_health", "Mental Health"],
              ["financial_health", "Financial Health"],
              ["friends_community", "Friends / Community"],
            ] as const
          ).map(([key, label]) => (
            <View key={key} style={s.qolCell}>
              <Text style={s.qolLabel}>{label}</Text>
              <Text style={s.qolNum}>{content.qol[key]}</Text>
            </View>
          ))}
        </View>

        <Section title="Business" data={content.business} />
        <Section title="Family" data={content.family} />
        <Section title="Personal" data={content.personal} />

        <View wrap={false}>
          <Text style={s.h2}>Most important thing coming up</Text>
          <Text style={s.p}>{content.coming_up.text || "—"}</Text>
          {content.coming_up.feelings.length > 0 && <Chips items={content.coming_up.feelings} />}
        </View>

        <View wrap={false}>
          <Text style={s.h2}>One energy vampire</Text>
          <Text style={s.p}>{content.energy_vampire || "—"}</Text>
        </View>

        <View wrap={false}>
          <Text style={s.h2}>One goal</Text>
          <Text style={s.p}>
            {content.goal.text || "—"}
            {content.goal.text ? <Text style={s.muted}>  · {content.goal.horizon}</Text> : null}
            {content.goal.make_commitment ? <Text style={s.badge}>  FORUM COMMITMENT</Text> : null}
          </Text>
        </View>

        <View wrap={false}>
          <Text style={s.h2}>Topic to present</Text>
          <Text style={s.p}>{content.topic.text || "—"}</Text>
          {content.topic.publish_to_parking_lot && content.topic.text ? (
            <Text style={[s.p, s.muted]}>
              Published to Parking Lot · {content.topic.tool_category} · {formatLabel}
            </Text>
          ) : null}
          {content.topic.context ? <Text style={[s.p, s.muted]}>{content.topic.context}</Text> : null}
          {content.topic.publish_to_parking_lot && phases ? (
            <Text style={[s.p, s.muted, { fontSize: 9 }]}>
              Phases: {phases.map((p, i) => `${i + 1}. ${p.name} (${p.default_seconds / 60}m)`).join(" · ")}
            </Text>
          ) : null}
        </View>

        <Text style={s.footer} fixed>
          This document is private to {meta.memberName} — except the Quality of Life numbers, which forum leadership can see in QOL History. Generated by Cupcake on this device.
        </Text>
      </Page>
    </Document>
  )
}
