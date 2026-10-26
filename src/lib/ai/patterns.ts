import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { aiMetadata, checkAiBudget } from "@/lib/ai/limits"
import { AI_MODEL } from "@/lib/ai/model"
import type { CurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import { updateContentSchema, type UpdateContent } from "@/lib/updates/schema"

// Server-only module, called from the /api/patterns route handler. Updates
// are end-to-end encrypted, so the server can't read them itself: the
// member's device decrypts their recent finalized updates, sends them here
// for one AI call, encrypts the resulting cards and stores them. Nothing
// from the request is kept beyond token counts.

export const MIN_UPDATES_REQUIRED = 3
export const MAX_UPDATES_FOR_PATTERNS = 6

// Hard caps mirroring aiOutputSchema. Enforced in code (clipCards) AND stated
// in the prompt, so model output can never fail our own validation.
const LIMITS = { title: 120, detail: 500, topic: 200, cards: 3 } as const

export type GeneratedCard = { title: string; detail: string; topic_suggestion: string }

const aiOutputSchema = z.object({
  cards: z
    .array(
      z.object({
        title: z.string().max(LIMITS.title),
        detail: z.string().max(LIMITS.detail),
        topic_suggestion: z.string().max(LIMITS.topic).optional().default(""),
      })
    )
    .max(LIMITS.cards),
})

export const patternsInputSchema = z.object({
  updates: z.array(updateContentSchema).min(MIN_UPDATES_REQUIRED).max(MAX_UPDATES_FOR_PATTERNS),
  /** yyyy-mm-dd per update, oldest first; purely for the prompt. */
  dates: z.array(z.string().max(10)).max(MAX_UPDATES_FOR_PATTERNS).optional(),
})

export type PatternsResult = { ok: true; cards: GeneratedCard[] } | { ok: false; error: string }

export async function generatePatternCards(
  me: CurrentMember,
  updates: UpdateContent[],
  dates: string[] = []
): Promise<PatternsResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "AI is not configured." }
  const budget = await checkAiBudget(me)
  if (!budget.ok) return { ok: false, error: budget.error }

  const history = updates
    .map((u, i) => `## Update ${i + 1} (${dates[i] ?? "date unknown"})\n${JSON.stringify(u, null, 2)}`)
    .join("\n\n")

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,
    timeout: 110_000,
  })

  const systemPrompt = `You are an analyst surfacing patterns in a YPO forum member's reflections. Look across their recent updates and find 1-3 patterns that would benefit from their attention.

Look for:
- QoL trends (e.g. mental health declining 4 months running)
- Recurring vampires that haven't been addressed
- Repeated significance threads (e.g. the same name or theme appearing across business / family)
- Goals that keep getting carried over
- Topics they keep almost-presenting but never publishing to the parking lot

Tone: warm, observational, never preachy. Frame each pattern as something to consider, not a verdict.

Return strictly valid JSON: {"cards":[{title, detail, topic_suggestion?}]}, at most ${LIMITS.cards} cards.
- title: at most ${LIMITS.title} characters, a named pattern (e.g. "Mental Health trending down 4 months")
- detail: 2-3 sentences, at most ${LIMITS.detail} characters
- topic_suggestion: optional, at most ${LIMITS.topic} characters. If the pattern is worth presenting to forum, give a one-line topic phrasing (e.g. "How I navigate co-CEO dynamics when our visions diverge"). Empty string otherwise.

If nothing meaningful jumps out, return an empty array. Better silent than to invent patterns.`

  const supabase = await createClient()
  try {
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 8192,
        thinking: { type: "adaptive" },
        metadata: aiMetadata(me),
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Recent updates from ${me.name}:\n\n${history}\n\nSurface up to ${LIMITS.cards} patterns.`,
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
      },
      { signal: AbortSignal.timeout(110_000) }
    )

    // Counted the moment it's billed, usable answer or not.
    await supabase.from("ai_interactions").insert({
      member_id: me.id,
      kind: "pattern_cards",
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    })

    if (response.stop_reason === "max_tokens") {
      console.warn("[patterns] response truncated at max_tokens", { member: me.id })
      return { ok: false, error: "The AI's answer got cut off. Try again later." }
    }
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[patterns] no text block in response", { member: me.id, stop_reason: response.stop_reason })
      return { ok: false, error: "No answer came back from the AI." }
    }
    const raw = JSON.parse(textBlock.text) as { cards?: unknown }
    const parsed = aiOutputSchema.parse({ cards: clipCards(raw.cards) })
    return { ok: true, cards: parsed.cards.map((c) => ({ ...c, topic_suggestion: c.topic_suggestion?.trim() ?? "" })) }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
      console.error("[patterns] timeout", { member: me.id })
      return { ok: false, error: "The AI took too long. Try again later." }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[patterns] connection error", { member: me.id, message: err.message })
      return { ok: false, error: "Couldn't reach the AI." }
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[patterns] Anthropic APIError", { member: me.id, status: err.status, name: err.name, message: err.message })
      return { ok: false, error: "The AI had a hiccup. Try again later." }
    }
    console.error("[patterns] non-API error", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: "Something went wrong generating patterns." }
  }
}

/** Coerce the model's cards onto our limits; drop empties; keep at most LIMITS.cards. */
function clipCards(cards: unknown): GeneratedCard[] {
  if (!Array.isArray(cards)) return []
  return cards
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      title: String(c.title ?? "").trim().slice(0, LIMITS.title),
      detail: String(c.detail ?? "").trim().slice(0, LIMITS.detail),
      topic_suggestion: String(c.topic_suggestion ?? "").trim().slice(0, LIMITS.topic),
    }))
    .filter((c) => c.title.length > 0 && c.detail.length > 0)
    .slice(0, LIMITS.cards)
}
