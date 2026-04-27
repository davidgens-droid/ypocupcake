"use server"

import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const MIN_UPDATES_REQUIRED = 3

export type PatternCard = {
  id: string
  title: string
  detail: string
  topic_suggestion: string | null
  generated_at: string
}

const aiOutputSchema = z.object({
  cards: z
    .array(
      z.object({
        title: z.string().max(120),
        detail: z.string().max(500),
        topic_suggestion: z.string().max(200).optional().default(""),
      })
    )
    .max(3),
})

export async function getOrGeneratePatternCards(): Promise<PatternCard[]> {
  const me = await requireCurrentMember()
  const supabase = await createClient()

  // Count member's finalized updates — also our cache key.
  const { count: updateCount } = await supabase
    .from("updates")
    .select("id", { count: "exact", head: true })
    .eq("member_id", me.id)
    .not("completed_at", "is", null)

  if (!updateCount || updateCount < MIN_UPDATES_REQUIRED) {
    return []
  }

  // Look for fresh cards.
  const { data: existing } = await supabase
    .from("ai_pattern_cards")
    .select("id, title, detail, topic_suggestion, generated_at")
    .eq("member_id", me.id)
    .eq("source_update_count", updateCount)
    .is("dismissed_at", null)
    .order("generated_at", { ascending: false })

  if (existing && existing.length > 0) {
    return existing
  }

  // Need to generate. Skip silently if AI isn't configured.
  if (!process.env.ANTHROPIC_API_KEY) return []

  const { data: updates } = await supabase
    .from("updates")
    .select("content, completed_at")
    .eq("member_id", me.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(6)

  if (!updates || updates.length < MIN_UPDATES_REQUIRED) return []

  const history = updates
    .reverse()
    .map(
      (u, i) =>
        `## Update ${i + 1} (${u.completed_at?.slice(0, 10) ?? "unknown date"})\n${JSON.stringify(u.content, null, 2)}`
    )
    .join("\n\n")

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const systemPrompt = `You are an analyst surfacing patterns in a YPO forum member's reflections. Look across their recent updates and find 1-3 patterns that would benefit from their attention.

Look for:
- QoL trends (e.g. mental health declining 4 months running)
- Recurring vampires that haven't been addressed
- Repeated significance threads (e.g. the same name or theme appearing across business / family)
- Goals that keep getting carried over
- Topics they keep almost-presenting but never publishing to the parking lot

Tone: warm, observational, never preachy. Frame each pattern as something to consider, not a verdict.

Return strictly valid JSON: {"cards":[{title, detail, topic_suggestion?}]}.
- title: under 120 chars, named pattern (e.g. "Mental Health trending down 4 months")
- detail: 2-3 sentences
- topic_suggestion: optional. If the pattern is worth presenting to forum, give a one-line topic phrasing (e.g. "How I navigate co-CEO dynamics when our visions diverge").

If nothing meaningful jumps out, return an empty array. Better silent than to invent patterns.`

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Recent updates from ${me.name}:\n\n${history}\n\nSurface up to 3 patterns.`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    topic_suggestion: { type: "string" },
                  },
                  required: ["title", "detail", "topic_suggestion"],
                },
              },
            },
            required: ["cards"],
          },
        },
      },
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") return []

    const parsed = aiOutputSchema.parse(JSON.parse(textBlock.text))

    await supabase.from("ai_interactions").insert({
      member_id: me.id,
      kind: "pattern_cards",
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    })

    if (parsed.cards.length === 0) return []

    const { data: inserted, error } = await supabase
      .from("ai_pattern_cards")
      .insert(
        parsed.cards.map((c) => ({
          member_id: me.id,
          title: c.title,
          detail: c.detail,
          topic_suggestion: c.topic_suggestion?.trim() || null,
          source_update_count: updateCount,
        }))
      )
      .select("id, title, detail, topic_suggestion, generated_at")

    if (error) {
      console.error("[patterns] insert failed:", error.message)
      return []
    }
    return inserted ?? []
  } catch (err) {
    console.error(
      "[patterns] generation failed:",
      err instanceof Error ? err.message : err
    )
    return []
  }
}

export async function dismissPatternCard(formData: FormData) {
  const me = await requireCurrentMember()
  const id = String(formData.get("id") ?? "")
  if (!id) return

  const supabase = await createClient()
  const { error } = await supabase
    .from("ai_pattern_cards")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("member_id", me.id)

  if (error) throw new Error(error.message)
  revalidatePath("/dashboard")
}
