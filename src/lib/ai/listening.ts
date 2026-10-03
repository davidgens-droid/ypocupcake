// Server-only module, called from the /api/listening route handler — NOT a
// Server Action. Server Actions invoked from client components are queued one
// after another by the app router, so a 20–60s extraction would block the
// moderator's next "reveal" click; a plain fetch to a route handler doesn't.
import Anthropic from "@anthropic-ai/sdk"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { AI_MODEL } from "@/lib/ai/model"
import type { CurrentMember } from "@/lib/auth/current-member"
import {
  LISTENING_MAX_CHARS,
  LISTENING_NOTE,
  type ListeningExtractResult,
  type ListeningTopic,
} from "@/lib/parking-lot/listening"
import { createClient } from "@/lib/supabase/server"

// Shorter than this and there's nothing to extract (a cough, a false start).
const MIN_CHARS = 40
// ~5–8 minutes of speech is 5–8k characters; this is a generous ceiling.
const MAX_CHARS = LISTENING_MAX_CHARS
const MAX_TOPICS = 5
const LIMITS = { topic: 200, context: 300 }
// Same default as quick-jot capture; refined later on the review screen.
const DEFAULT_FORMAT = "fsfe"

// Clip rather than reject an over-long transcript: refusing would throw away
// a whole update's worth of listening over a length nobody chose.
const inputSchema = z.object({
  meetingId: z.string().uuid(),
  presenterMemberId: z.string().uuid(),
  transcript: z.string().transform((s) => s.slice(0, MAX_CHARS)),
})

// No array bound here or in the JSON schema below: the API's structured-output
// schema rejects `maxItems`, so the cap is enforced in code after parsing.
const outputSchema = z.object({
  topics: z.array(z.object({ topic: z.string(), context: z.string() })),
})

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
 * Cupcake never stores or logs the transcript — not in the database, not in
 * ai_interactions (token counts only), not in server logs. It is sent once to
 * Anthropic's API (which does not train on it and retains inputs under its
 * own policy, up to 30 days) and exists here only for this request.
 */
export async function extractParkingLotTopics(
  me: CurrentMember,
  input: { meetingId: string; presenterMemberId: string; transcript: string }
): Promise<ListeningExtractResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI is not configured (missing ANTHROPIC_API_KEY)." }
  }

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
    return { ok: false, error: "Listening mode: that request was malformed. Nothing was saved." }
  }
  const transcript = parsed.data.transcript.replace(/\s+/g, " ").trim()
  if (transcript.length < MIN_CHARS) return { ok: true, topics: [] }

  // The ids come from the client: make sure they're OUR meeting (and one
  // that's actually running) and OUR member before spending tokens or
  // attaching suggestions to anyone.
  const [{ data: meeting }, { data: presenter }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, status")
      .eq("id", parsed.data.meetingId)
      .eq("forum_id", me.forum_id)
      .maybeSingle(),
    supabase
      .from("members")
      .select("name")
      .eq("id", parsed.data.presenterMemberId)
      .eq("forum_id", me.forum_id)
      .maybeSingle(),
  ])
  if (!meeting || meeting.status !== "in_progress") {
    return { ok: false, error: "Listening mode: that meeting isn't running. Nothing was saved." }
  }
  if (!presenter) {
    return { ok: false, error: "Listening mode: that presenter isn't in your forum. Nothing was saved." }
  }
  const firstName = presenter.name?.split(" ")[0] ?? "the member"

  // One retry: the SDK's retry-after sleep ignores the abort signal, so two
  // retries could outlive the page's 120s maxDuration (55 + 55 + backoff).
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 1,
    timeout: 55_000,
  })

  let topics: ListeningTopic[]
  let usage: { input_tokens: number; output_tokens: number }
  try {
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        // Thinking tokens count against this: with room to spare, a long
        // transcript can never crowd out the (small) JSON answer.
        max_tokens: 16_000,
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
          // Listing 0–5 dilemmas is not a deep-reasoning task; medium keeps
          // a long transcript well inside the per-attempt timeout.
          effort: "medium",
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
    if (response.stop_reason === "refusal") {
      console.warn("[listening] model refused", { member: me.id })
      return { ok: false, error: "Listening mode: the AI declined to process that update. Nothing was saved." }
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

  // Idempotency without a schema change: if another device (or a retried
  // flush) already captured listening suggestions for this presenter in this
  // meeting, don't add the same dilemma twice.
  const { data: existing } = await supabase
    .from("parking_lot_items")
    .select("topic")
    .eq("captured_meeting_id", parsed.data.meetingId)
    .eq("submitter_member_id", parsed.data.presenterMemberId)
    .eq("status", "captured")
    .like("context", `${LISTENING_NOTE}%`)
  const already = new Set((existing ?? []).map((r) => (r.topic as string).trim().toLowerCase()))
  topics = topics.filter((t) => !already.has(t.topic.toLowerCase()))
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
