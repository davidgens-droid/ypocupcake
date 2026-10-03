"use server"

import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { AI_MODEL } from "@/lib/ai/model"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { LISTENING_NOTE } from "@/lib/parking-lot/listening"
import { createClient } from "@/lib/supabase/server"

// Shorter than this and there's nothing to extract (a cough, a false start).
const MIN_CHARS = 40
// ~5–8 minutes of speech is 5–8k characters; this is a generous ceiling.
const MAX_CHARS = 40_000
const MAX_TOPICS = 5
const LIMITS = { topic: 200, context: 300 }
// Same default as quick-jot capture; refined later on the review screen.
const DEFAULT_FORMAT = "fsfe"

const inputSchema = z.object({
  meetingId: z.string().uuid(),
  presenterMemberId: z.string().uuid(),
  transcript: z.string().max(MAX_CHARS),
})

// No array bound here or in the JSON schema below: the API's structured-output
// schema rejects `maxItems`, so the cap is enforced in code after parsing.
const outputSchema = z.object({
  topics: z.array(z.object({ topic: z.string(), context: z.string() })),
})

export type ListeningTopic = { topic: string; context: string }
export type ListeningExtractResult =
  | { ok: true; topics: ListeningTopic[] }
  | { ok: false; error: string }

const SYSTEM_PROMPT = `You read a rough, automatic speech transcript of one YPO forum member's monthly update (business, family, personal; feelings and why they matter; what's coming up; an energy vampire; a goal) and list the POTENTIAL parking-lot topics in it: issues, decisions or dilemmas the forum might want to explore together at a future meeting.

WHAT COUNTS AS A PARKING-LOT TOPIC
- A live question or tension the member is sitting with: a decision not yet made, a relationship or leadership pattern they keep hitting, a fear or trade-off that would benefit from the forum's experience, anything they say they'd like the group's take on.
- Not: plain news or status, feelings on their own, logistics, or things already resolved.
- Zero to five. Zero is a fine answer. Prefer the few that matter; never pad.

HOW TO WRITE EACH ONE
- topic: a short, neutral title the moderator could read aloud (under 120 characters), framed as the member's question or dilemma. Examples: "Whether to bring a co-founder's underperformance to the board", "Who they are once the business is sold".
- context: one or two sentences (under 300 characters) on why it seems alive for them, paraphrased in your own words. Never quote the transcript.

PRIVACY (this is confidential forum material)
- Do not include names of third parties, other companies, dollar amounts, medical or legal specifics, or anything not needed to recognise the topic. Describe the dilemma generically.
- The transcript is machine-generated: expect misheard words, missing punctuation and run-ons. Don't invent topics to explain garbled passages; when unsure, leave it out.
- Other voices (the moderator, other members) may be mixed in. Only the member's own update matters.

OUTPUT: exactly one JSON object {"topics":[{"topic":string,"context":string}]} and nothing else.`

/**
 * Listening mode: given the transcript of one member's update (captured in the
 * moderator's browser and sent here once), ask Claude for the potential
 * parking-lot topics and park them as 'captured' suggestions for the presenter,
 * to be kept / merged / deleted on the post-meeting review screen.
 *
 * The transcript is never stored or logged — not in the database, not in
 * ai_interactions (token counts only), not in server logs. It exists in this
 * request and is gone.
 */
export async function extractParkingLotTopics(input: {
  meetingId: string
  presenterMemberId: string
  transcript: string
}): Promise<ListeningExtractResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI is not configured (missing ANTHROPIC_API_KEY)." }
  }

  const me = await requireCurrentMember()
  const supabase = await createClient()

  // Same roles that may live-capture (the insert's RLS enforces this too, but
  // the AI call happens first — don't let an unprivileged caller spend tokens).
  const { data: roles } = await supabase
    .from("roles")
    .select("role_type")
    .eq("member_id", me.id)
    .eq("year", new Date().getFullYear())
  const privileged =
    me.is_admin ||
    (roles ?? []).some((r) =>
      ["moderator", "assistant_moderator", "czar"].includes(r.role_type)
    )
  if (!privileged) {
    return { ok: false, error: "Only the moderator, assistant moderator, czar or an admin can use listening mode." }
  }

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "That update was too long to process in one go." }
  }
  const transcript = parsed.data.transcript.replace(/\s+/g, " ").trim()
  if (transcript.length < MIN_CHARS) return { ok: true, topics: [] }

  const { data: presenter } = await supabase
    .from("members")
    .select("name")
    .eq("id", parsed.data.presenterMemberId)
    .maybeSingle()
  const firstName = presenter?.name?.split(" ")[0] ?? "the member"

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 55_000,
  })

  let topics: ListeningTopic[]
  let usage: { input_tokens: number; output_tokens: number }
  try {
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Member presenting: ${firstName}

Transcript (automatic speech recognition; may be rough):
<transcript>
${transcript}
</transcript>

List the potential parking-lot topics.`,
          },
        ],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                topics: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      topic: { type: "string" },
                      context: { type: "string" },
                    },
                    required: ["topic", "context"],
                  },
                },
              },
              required: ["topics"],
            },
          },
        },
      },
      // Overall deadline across retries; the moderator isn't blocked on this,
      // but the function still has to finish inside the page's maxDuration.
      { signal: AbortSignal.timeout(90_000) }
    )

    if (response.stop_reason === "max_tokens") {
      console.warn("[listening] response truncated", { member: me.id })
      return { ok: false, error: "Listening mode: the extraction got cut off. Nothing was saved." }
    }
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "Listening mode: no result came back. Nothing was saved." }
    }
    const out = outputSchema.safeParse(JSON.parse(textBlock.text))
    if (!out.success) {
      console.warn("[listening] output failed schema", { member: me.id })
      return { ok: false, error: "Listening mode: the result was malformed. Nothing was saved." }
    }
    usage = response.usage

    // Clip, drop empties, dedupe (case-insensitive) — the model occasionally
    // phrases the same dilemma twice.
    const seen = new Set<string>()
    topics = []
    for (const t of out.data.topics) {
      if (topics.length >= MAX_TOPICS) break
      const topic = t.topic.replace(/\s+/g, " ").trim().slice(0, LIMITS.topic)
      const context = t.context.replace(/\s+/g, " ").trim().slice(0, LIMITS.context)
      const key = topic.toLowerCase()
      if (!topic || seen.has(key)) continue
      seen.add(key)
      topics.push({ topic, context })
    }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
      console.error("[listening] timeout", { member: me.id })
      return { ok: false, error: "Listening mode: extraction timed out. Nothing was saved." }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[listening] connection error", { member: me.id, message: err.message })
      return { ok: false, error: "Listening mode: couldn't reach the AI. Nothing was saved." }
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[listening] Anthropic APIError", {
        member: me.id, status: err.status, name: err.name, message: err.message,
      })
      return { ok: false, error: "Listening mode: the AI had a hiccup. Nothing was saved." }
    }
    console.error("[listening] non-API error", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: "Listening mode: something went wrong. Nothing was saved." }
  }

  // Token counts only — never the transcript.
  await supabase.from("ai_interactions").insert({
    member_id: me.id,
    kind: "listening_extract",
    tokens_in: usage.input_tokens,
    tokens_out: usage.output_tokens,
  })

  if (topics.length === 0) return { ok: true, topics: [] }

  const { data: fmt } = await supabase
    .from("exploration_formats")
    .select("category")
    .eq("code", DEFAULT_FORMAT)
    .maybeSingle()
  const tool_category = fmt?.category === "IQ" ? "IQ" : "EQ"

  const { error } = await supabase.from("parking_lot_items").insert(
    topics.map((t) => ({
      forum_id: me.forum_id,
      submitter_member_id: parsed.data.presenterMemberId,
      added_by_member_id: me.id,
      topic: t.topic,
      context: t.context ? `${LISTENING_NOTE}\n${t.context}` : LISTENING_NOTE,
      urgency: "med",
      tool_category,
      exploration_format: DEFAULT_FORMAT,
      status: "captured",
      captured_meeting_id: parsed.data.meetingId,
    }))
  )
  if (error) {
    console.error("[listening] insert failed", { member: me.id, message: error.message })
    return { ok: false, error: "Listening mode: found topics but couldn't save them." }
  }

  revalidatePath(`/meeting/${parsed.data.meetingId}/run`)
  revalidatePath(`/meeting/${parsed.data.meetingId}`)
  revalidatePath(`/meeting/${parsed.data.meetingId}/parking-lot-review`)
  return { ok: true, topics }
}
