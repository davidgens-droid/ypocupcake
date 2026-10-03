"use server"

import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { AI_MODEL } from "@/lib/ai/model"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

const MIN_UPDATES_REQUIRED = 3

// Hard caps mirroring aiOutputSchema and the ai_pattern_cards columns. Enforced
// in code (clipCards) AND stated in the prompt, so model output can never fail
// our own validation and throw the whole batch away.
const LIMITS = { title: 120, detail: 500, topic: 200, cards: 3 } as const

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
        title: z.string().max(LIMITS.title),
        detail: z.string().max(LIMITS.detail),
        topic_suggestion: z.string().max(LIMITS.topic).optional().default(""),
      })
    )
    .max(LIMITS.cards),
})

/**
 * Return the member's current pattern cards, generating a fresh set only when
 * their finalized-update count has changed since the last generation (that
 * count is the cache key). Member-private: RLS scopes every read to the caller.
 *
 * This runs inside the dashboard's render, so every failure path returns []
 * rather than throwing — a flaky AI call must never take the dashboard down.
 * The real cause is always logged so it's diagnosable in Vercel logs.
 */
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

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Retry transient overloads (429/529) and connection blips with backoff.
    // The overall deadline on the request below keeps retries from ever
    // pushing total time past the dashboard's 120s function budget.
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

  try {
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        // Adaptive thinking shares this budget with the JSON answer; the answer
        // itself is small (≤3 short cards), so 8192 leaves thinking plenty of
        // room without risking a truncated payload.
        max_tokens: 8192,
        thinking: { type: "adaptive" },
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
      // Overall deadline across retries, under the dashboard's 120s
      // maxDuration, so a hung attempt + retry can never get the page's render
      // killed by the platform.
      { signal: AbortSignal.timeout(110_000) }
    )

    // If the model hit the token ceiling the JSON is truncated and would fail
    // to parse with a cryptic error. Catch it explicitly.
    if (response.stop_reason === "max_tokens") {
      console.warn("[patterns] response truncated at max_tokens", {
        member: me.id,
        usage: response.usage,
      })
      return []
    }

    // First text block is the JSON payload (thinking blocks are skipped).
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[patterns] no text block in response", {
        member: me.id,
        stop_reason: response.stop_reason,
        block_types: response.content.map((b) => b.type),
      })
      return []
    }

    // Clip to our limits BEFORE validating, so one over-long card degrades to a
    // trimmed card instead of the whole batch being thrown away.
    const raw = JSON.parse(textBlock.text) as { cards?: unknown }
    const parsed = aiOutputSchema.parse({ cards: clipCards(raw.cards) })

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
      console.error("[patterns] insert failed", { member: me.id, message: error.message })
      return []
    }
    return inserted ?? []
  } catch (err) {
    // Every path returns [] (never take the dashboard down), but log the real
    // cause so a failure is diagnosable in Vercel logs. Order matters: abort,
    // timeout and connection errors are all subclasses of APIError, so check
    // the specific ones first.
    if (err instanceof Anthropic.APIUserAbortError) {
      console.error("[patterns] overall deadline hit", { member: me.id })
      return []
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      console.error("[patterns] timeout", { member: me.id, message: err.message })
      return []
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[patterns] connection error", { member: me.id, message: err.message })
      return []
    }
    if (err instanceof Anthropic.APIError) {
      // 429 = rate limited, 529 = overloaded, 5xx = transient server-side.
      console.error("[patterns] Anthropic APIError", {
        member: me.id,
        status: err.status,
        name: err.name,
        message: err.message,
      })
      return []
    }
    // Anything else — most likely a JSON.parse or Zod failure on the payload.
    console.error("[patterns] non-API error", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Coerce the model's cards onto our limits: trim, cap each field's length,
 * drop cards with no title or detail, and keep at most LIMITS.cards.
 */
function clipCards(
  cards: unknown
): { title: string; detail: string; topic_suggestion: string }[] {
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
