"use server"

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  type UpdateContent,
} from "@/lib/updates/schema"

// ─── AI output schema ───────────────────────────────────────────────────────
// Flat structure that maps cleanly to JSON Schema (no tuples, no min/max
// constraints). We transform to the canonical UpdateContent shape after parse.
const aiSectionSchema = z.object({
  feelings: z.array(z.string()).describe("3 to 5 single-word feelings (e.g. 'frustrated', 'hopeful')"),
  situation: z
    .string()
    .describe("One sentence describing what caused these feelings."),
  why_layer_1: z.string().describe("First layer of why this matters."),
  why_layer_2: z.string().describe("Deeper second-layer why."),
  why_layer_3: z.string().describe("Deepest third-layer why."),
})

const aiUpdateSchema = z.object({
  qol: z.object({
    physical_health: z.number().describe("1 (struggling) to 10 (thriving)"),
    mental_health: z.number().describe("1 to 10"),
    financial_health: z.number().describe("1 to 10"),
    friends_community: z.number().describe("1 to 10"),
  }),
  business: aiSectionSchema,
  family: aiSectionSchema,
  personal: aiSectionSchema,
  coming_up_text: z
    .string()
    .describe("The most important thing coming up in the next month"),
  coming_up_feelings: z
    .array(z.string())
    .describe("3 single-word feelings about it"),
  energy_vampire: z
    .string()
    .describe("One person or thing that drains energy. Empty string if none mentioned."),
  goal_text: z.string().describe("One concrete goal. Empty string if none mentioned."),
  goal_horizon: z.enum(["day", "week", "month"]),
  topic_text: z
    .string()
    .describe(
      "A topic the member would like to present to forum. Empty string if none mentioned."
    ),
})

export type AiUpdateInput = z.infer<typeof aiUpdateSchema>

// ─── Server action ──────────────────────────────────────────────────────────
export async function generateUpdateFromBrainDump(input: {
  brainDump: string
}): Promise<{ ok: true; content: UpdateContent } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI is not configured (missing ANTHROPIC_API_KEY)." }
  }

  const me = await requireCurrentMember()

  // Pull the member's last 3 finalized updates to give the AI context (so
  // recurring themes carry over and QoL ratings stay calibrated). RLS
  // ensures we only ever see this member's own updates.
  const supabase = await createClient()
  const { data: pastUpdates } = await supabase
    .from("updates")
    .select("content, completed_at")
    .eq("member_id", me.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(3)

  const historyContext = (pastUpdates ?? [])
    .map((u, i) => `## Past update ${i + 1}\n${JSON.stringify(u.content, null, 2)}`)
    .join("\n\n")

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // Retry transient overloads (429/529) and connection blips with backoff.
    maxRetries: 3,
    // Fail just under the 60s function budget so we can surface a clean error
    // instead of being killed mid-call by the platform.
    timeout: 55_000,
  })

  const systemPrompt = `You are an empathic assistant helping a YPO forum member structure a brain-dump into a YPO 5% Reflection update.

Rules:
1. Use only what the member has said. Do NOT invent feelings, situations, or scores. If something isn't mentioned, leave it empty (empty string for text, empty array for chips, 5 for QoL scores).
2. Feelings: 3-5 single-word emotion words per section (e.g. "frustrated", "hopeful", "grateful"). Title-case.
3. Situations: ONE sentence each. Hard cap.
4. Significance: three progressively deeper "why" layers. Each layer should reveal something not in the previous. Layer 3 should be the rawest, most personal truth.
5. QoL scores 1-10: only score what was mentioned. Default to 5 if no signal.
6. Energy vampire: one drain. Empty if not mentioned.
7. Goal: one concrete, achievable commitment. Empty if not mentioned.
8. Topic: a topic the member would benefit from exploring with forum. Empty if not mentioned.

Tone: warm, never preachy. The member is the author — you're scaffolding, not coaching.`

  const userPrompt = `Brain dump from ${me.name}:

${input.brainDump}

${historyContext ? `\nFor calibration, here's recent context (do not copy from these — use only the brain dump above for content):\n\n${historyContext}` : ""}

Now structure this into the YPO update fields.`

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      // Adaptive thinking shares this budget with the JSON answer. 8192 was
      // tight: a long dump could let thinking crowd out the output, truncating
      // the JSON and breaking the parse. 16384 gives both room to breathe.
      max_tokens: 16384,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              qol: {
                type: "object",
                additionalProperties: false,
                properties: {
                  physical_health: { type: "integer" },
                  mental_health: { type: "integer" },
                  financial_health: { type: "integer" },
                  friends_community: { type: "integer" },
                },
                required: [
                  "physical_health",
                  "mental_health",
                  "financial_health",
                  "friends_community",
                ],
              },
              business: sectionJsonSchema(),
              family: sectionJsonSchema(),
              personal: sectionJsonSchema(),
              coming_up_text: { type: "string" },
              coming_up_feelings: { type: "array", items: { type: "string" } },
              energy_vampire: { type: "string" },
              goal_text: { type: "string" },
              goal_horizon: { type: "string", enum: ["day", "week", "month"] },
              topic_text: { type: "string" },
            },
            required: [
              "qol",
              "business",
              "family",
              "personal",
              "coming_up_text",
              "coming_up_feelings",
              "energy_vampire",
              "goal_text",
              "goal_horizon",
              "topic_text",
            ],
          },
        },
      },
    })

    // If the model hit the token ceiling, the JSON answer is truncated and
    // JSON.parse below would throw a cryptic error. Catch it explicitly.
    if (response.stop_reason === "max_tokens") {
      console.warn("[brain-dump] response truncated at max_tokens", {
        member: me.id,
        usage: response.usage,
      })
      return {
        ok: false,
        error:
          "That was a lot to process and the response got cut off. Try again, or break it into a slightly shorter dump.",
      }
    }

    // First text block is the JSON payload (thinking blocks are skipped).
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[brain-dump] no text block in response", {
        member: me.id,
        stop_reason: response.stop_reason,
        block_types: response.content.map((b) => b.type),
      })
      return { ok: false, error: "No structured response from AI. Please try again." }
    }

    const parsed = aiUpdateSchema.parse(JSON.parse(textBlock.text))

    // Log usage for cost-cap visibility.
    await supabase.from("ai_interactions").insert({
      member_id: me.id,
      kind: "brain_dump",
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    })

    return { ok: true, content: toUpdateContent(parsed) }
  } catch (err) {
    // Log the real cause to the server (visible in Vercel logs) so any future
    // failure is diagnosable instead of a mystery. Order matters: timeout and
    // connection errors are subclasses of APIError, so check them first.
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      console.error("[brain-dump] timeout", { member: me.id, message: err.message })
      return {
        ok: false,
        error: "That took too long to process. Try again, or shorten your dump a little.",
      }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[brain-dump] connection error", { member: me.id, message: err.message })
      return {
        ok: false,
        error: "Couldn't reach the AI. Check your connection and try again.",
      }
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[brain-dump] Anthropic APIError", {
        member: me.id,
        status: err.status,
        name: err.name,
        message: err.message,
      })
      // 429 = rate limited, 529 = overloaded, 5xx = transient server-side.
      if (err.status === 429 || err.status === 529) {
        return {
          ok: false,
          error: "The AI is busy right now. Give it a few seconds and try again.",
        }
      }
      if (typeof err.status === "number" && err.status >= 500) {
        return {
          ok: false,
          error: "The AI had a hiccup on its end. Please try again.",
        }
      }
      return { ok: false, error: err.message }
    }
    // Anything else — most likely a JSON.parse or Zod failure on the payload.
    console.error("[brain-dump] non-API error", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return {
      ok: false,
      error: "Something went wrong structuring your update. Please try again.",
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function sectionJsonSchema() {
  return {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      feelings: { type: "array" as const, items: { type: "string" as const } },
      situation: { type: "string" as const },
      why_layer_1: { type: "string" as const },
      why_layer_2: { type: "string" as const },
      why_layer_3: { type: "string" as const },
    },
    required: ["feelings", "situation", "why_layer_1", "why_layer_2", "why_layer_3"],
  }
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)))
}

function clip<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max)
}

function toUpdateContent(ai: AiUpdateInput): UpdateContent {
  const draft: UpdateContent = {
    ...emptyUpdateContent,
    qol: {
      physical_health: clampScore(ai.qol.physical_health),
      mental_health: clampScore(ai.qol.mental_health),
      financial_health: clampScore(ai.qol.financial_health),
      friends_community: clampScore(ai.qol.friends_community),
    },
    business: {
      feelings: clip(ai.business.feelings, 5),
      situation: ai.business.situation.slice(0, 280),
      significance: [
        ai.business.why_layer_1,
        ai.business.why_layer_2,
        ai.business.why_layer_3,
      ],
    },
    family: {
      feelings: clip(ai.family.feelings, 5),
      situation: ai.family.situation.slice(0, 280),
      significance: [
        ai.family.why_layer_1,
        ai.family.why_layer_2,
        ai.family.why_layer_3,
      ],
    },
    personal: {
      feelings: clip(ai.personal.feelings, 5),
      situation: ai.personal.situation.slice(0, 280),
      significance: [
        ai.personal.why_layer_1,
        ai.personal.why_layer_2,
        ai.personal.why_layer_3,
      ],
    },
    coming_up: {
      text: ai.coming_up_text,
      feelings: clip(ai.coming_up_feelings, 3),
    },
    energy_vampire: ai.energy_vampire,
    goal: {
      text: ai.goal_text,
      horizon: ai.goal_horizon,
      make_commitment: false,
    },
    topic: {
      ...emptyUpdateContent.topic,
      text: ai.topic_text,
    },
  }
  return draft
}
