"use server"

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"
import {
  emptyUpdateContent,
  isEmptyUpdate,
  updateContentSchema,
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

export type BrainDumpMode = "create" | "refine"

export type BrainDumpResult =
  | { ok: true; content: UpdateContent; mode: BrainDumpMode }
  | { ok: false; error: string }

// Hard caps mirroring updateContentSchema. Enforced in code (toUpdateContent)
// AND stated in the prompt, so AI output can never fail the app's own schema.
const LIMITS = {
  situation: 280,
  whyLayer: 500,
  comingUp: 500,
  vampire: 280,
  goal: 500,
  topic: 500,
  feeling: 40,
} as const

// ─── Server action ──────────────────────────────────────────────────────────
/**
 * Turn a free-form brain-dump into a structured update.
 *
 * Two modes, chosen automatically and reported back in `mode`:
 * - CREATE: `existing` is absent or untouched → structure the dump from scratch.
 * - REFINE: `existing` already has content → fold the new dump into it. The
 *   member can come back as many times as they like; nothing they've already
 *   written is dropped unless the new dump says to remove it.
 *
 * Whenever `existing` is supplied, its hand-set settings (parking-lot publish
 * choice, exploration format, urgency, topic context, commitment flag) are
 * preserved in BOTH modes. If `existing` is malformed we refuse rather than
 * silently falling back to CREATE — that fallback is exactly how a refine
 * could wipe a member's update.
 */
export async function generateUpdateFromBrainDump(input: {
  brainDump: string
  existing?: UpdateContent
}): Promise<BrainDumpResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI is not configured (missing ANTHROPIC_API_KEY)." }
  }

  const me = await requireCurrentMember()

  let base: UpdateContent = emptyUpdateContent
  let refining = false
  if (input.existing !== undefined) {
    const parsed = updateContentSchema.safeParse(input.existing)
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path.join(".") || "a field"
      console.warn("[brain-dump] existing content failed validation", {
        member: me.id,
        path,
        issue: parsed.error.issues[0]?.message,
      })
      return {
        ok: false,
        error: `Your current draft has a problem in "${path}" (most likely over its length limit). Fix that field, then try the brain-dump again.`,
      }
    }
    base = parsed.data
    refining = !isEmptyUpdate(parsed.data)
  }

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
    // The overall deadline below (AbortSignal) keeps retries from ever pushing
    // total time past the page's 120s function budget.
    maxRetries: 3,
    timeout: 110_000,
  })

  const sharedRules = `Rules:
1. Use only what the member has said. Do NOT invent feelings, situations, or scores.
2. Feelings: 3-5 single-word emotion words per section (e.g. "frustrated", "hopeful", "grateful"). Title-case. Each word at most ${LIMITS.feeling} characters.
3. Situations: ONE sentence each, at most ${LIMITS.situation} characters. Hard cap.
4. Significance: three progressively deeper "why" layers, each at most ${LIMITS.whyLayer} characters. Each layer should reveal something not in the previous. Layer 3 should be the rawest, most personal truth.
5. Energy vampire: one drain, at most ${LIMITS.vampire} characters. Empty if not mentioned.
6. Goal: one concrete, achievable commitment, at most ${LIMITS.goal} characters. Empty if not mentioned.
7. Topic: a topic the member would benefit from exploring with forum, at most ${LIMITS.topic} characters. Empty if not mentioned.
8. "Most important thing coming up": at most ${LIMITS.comingUp} characters.

Tone: warm, never preachy. The member is the author — you're scaffolding, not coaching.`

  const systemPrompt = refining
    ? `You are an empathic assistant helping a YPO forum member REFINE an update they've already drafted.

You will receive the member's current draft inside <current_draft> — it uses EXACTLY the same field names you must return — and their new thoughts inside <new_input>. Produce the COMPLETE updated draft: every field, not just the changed ones.

Refinement principles — these override the general rules below:
- Carry forward every existing field that is still true. Do NOT drop, blank out, shorten, or "improve" content the member did not ask to change.
- Any field you are NOT changing must be copied character-for-character from <current_draft>. That includes feelings lists (even if an untouched section has fewer than 3 feelings — do not pad it), QoL scores, the goal, and the topic.
- Where <new_input> ADDS detail to a section, enrich that section. Where it CORRECTS something, replace the old with the new. Where it says to REMOVE something, remove it.
- QoL scores: keep the existing scores unless <new_input> gives a clear signal to change a specific one. Never reset to 5.
- There is exactly one goal field and one topic field. If the member asks to add a second, combine it with the existing one in a single natural sentence.
- Treat the draft as the member's own words. Preserve their voice.

${sharedRules}`
    : `You are an empathic assistant helping a YPO forum member structure a brain-dump into a YPO 5% Reflection update.

${sharedRules}
9. If something isn't mentioned, leave it empty (empty string for text, empty array for chips).
10. QoL scores 1-10: only score what was mentioned. Default to 5 if no signal.`

  const userPrompt = refining
    ? `<current_draft>
${JSON.stringify(toAiShape(base), null, 2)}
</current_draft>

<new_input>
${input.brainDump}
</new_input>

${historyContext ? `<calibration_only>\nThese are ${me.name}'s past updates, for calibrating tone and QoL only. Do NOT copy content from them.\n\n${historyContext}\n</calibration_only>\n\n` : ""}Now return the complete refined draft for ${me.name}, keeping everything that is still true.`
    : `Brain dump from ${me.name}:

${input.brainDump}

${historyContext ? `\nFor calibration, here's recent context (do not copy from these — use only the brain dump above for content):\n\n${historyContext}` : ""}

Now structure this into the YPO update fields.`

  try {
    const response = await client.messages.create(
      {
        model: "claude-fable-5-1",
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
      },
      // Overall deadline across retries, under the page's 120s maxDuration, so
      // a hung attempt + retry can never get the function killed mid-call.
      { signal: AbortSignal.timeout(110_000) }
    )

    // If the model hit the token ceiling, the JSON answer is truncated and
    // JSON.parse below would throw a cryptic error. Catch it explicitly.
    if (response.stop_reason === "max_tokens") {
      console.warn("[brain-dump] response truncated at max_tokens", {
        member: me.id,
        refining,
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
    const content = toUpdateContent(parsed, base)

    // Belt and braces: never hand the client content that fails the app's own
    // schema (the builder's auto-save and finalize would reject it, and a later
    // refine would be refused).
    const check = updateContentSchema.safeParse(content)
    if (!check.success) {
      console.warn("[brain-dump] generated content failed schema", {
        member: me.id,
        refining,
        issue: check.error.issues[0],
      })
      return {
        ok: false,
        error:
          "The AI produced an update that didn't fit the form (a field came back too long). Please try again.",
      }
    }

    // Log usage for cost-cap visibility.
    await supabase.from("ai_interactions").insert({
      member_id: me.id,
      kind: refining ? "brain_dump_refine" : "brain_dump",
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    })

    return { ok: true, content: check.data, mode: refining ? "refine" : "create" }
  } catch (err) {
    // Log the real cause to the server (visible in Vercel logs) so any future
    // failure is diagnosable instead of a mystery. Order matters: abort,
    // timeout and connection errors are all subclasses of APIError, so check
    // the specific ones first.
    if (err instanceof Anthropic.APIUserAbortError) {
      console.error("[brain-dump] overall deadline hit", { member: me.id, refining })
      return {
        ok: false,
        error: "That took too long to process. Try again, or shorten your dump a little.",
      }
    }
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

function clipStr(s: string, max: number): string {
  return s.trim().slice(0, max)
}

/** Trim, drop blanks, cap each word at the schema's 40 chars, cap the count. */
function normFeelings(arr: string[], max: number): string[] {
  return arr
    .map((s) => s.trim().slice(0, LIMITS.feeling))
    .filter((s) => s.length > 0)
    .slice(0, max)
}

/**
 * Project an UpdateContent onto the flat shape the model must RETURN, so a
 * refine shows the model exactly the keys it answers with and nothing else.
 * Non-AI fields (publish flag, format, urgency, topic context, commitment)
 * are deliberately omitted — they never go through the model.
 */
function toAiShape(c: UpdateContent): AiUpdateInput {
  const sec = (s: UpdateContent["business"]) => ({
    feelings: s.feelings,
    situation: s.situation,
    why_layer_1: s.significance[0],
    why_layer_2: s.significance[1],
    why_layer_3: s.significance[2],
  })
  return {
    qol: { ...c.qol },
    business: sec(c.business),
    family: sec(c.family),
    personal: sec(c.personal),
    coming_up_text: c.coming_up.text,
    coming_up_feelings: c.coming_up.feelings,
    energy_vampire: c.energy_vampire,
    goal_text: c.goal.text,
    goal_horizon: c.goal.horizon,
    topic_text: c.topic.text,
  }
}

/**
 * Map the AI's flat output onto UpdateContent, clipping every field to the
 * app schema's limits. `base` supplies the fields the AI does not own — the
 * member's parking-lot publish choice, exploration format, urgency, topic
 * context, and the "make it a commitment" flag — so those are never silently
 * reset. In CREATE mode with no existing content `base` is the empty default.
 */
function toUpdateContent(ai: AiUpdateInput, base: UpdateContent): UpdateContent {
  const section = (s: AiUpdateInput["business"]): UpdateContent["business"] => ({
    feelings: normFeelings(s.feelings, 5),
    situation: clipStr(s.situation, LIMITS.situation),
    significance: [
      clipStr(s.why_layer_1, LIMITS.whyLayer),
      clipStr(s.why_layer_2, LIMITS.whyLayer),
      clipStr(s.why_layer_3, LIMITS.whyLayer),
    ],
  })

  const goalText = clipStr(ai.goal_text, LIMITS.goal)
  const topicText = clipStr(ai.topic_text, LIMITS.topic)

  return {
    ...base,
    qol: {
      physical_health: clampScore(ai.qol.physical_health),
      mental_health: clampScore(ai.qol.mental_health),
      financial_health: clampScore(ai.qol.financial_health),
      friends_community: clampScore(ai.qol.friends_community),
    },
    business: section(ai.business),
    family: section(ai.family),
    personal: section(ai.personal),
    coming_up: {
      text: clipStr(ai.coming_up_text, LIMITS.comingUp),
      feelings: normFeelings(ai.coming_up_feelings, 3),
    },
    energy_vampire: clipStr(ai.energy_vampire, LIMITS.vampire),
    goal: {
      text: goalText,
      horizon: ai.goal_horizon,
      // A commitment opt-in belongs to the goal the member opted in on. Keep it
      // only if that goal is still there unchanged; a new or reworded goal
      // needs a fresh opt-in.
      make_commitment:
        base.goal.make_commitment &&
        goalText.length > 0 &&
        goalText === base.goal.text.trim(),
    },
    topic: {
      ...base.topic,
      text: topicText,
      // Never carry a "publish to parking lot" choice onto an empty topic.
      publish_to_parking_lot:
        base.topic.publish_to_parking_lot && topicText.length > 0,
    },
  }
}
