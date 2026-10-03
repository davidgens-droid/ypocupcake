"use server"

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { AI_MODEL } from "@/lib/ai/model"
import type {
  InterviewCoverage,
  InterviewMessage,
  InterviewTurnResult,
} from "@/lib/ai/interview-types"
import { requireCurrentMember } from "@/lib/auth/current-member"
import { createClient } from "@/lib/supabase/server"

/** Hard cap on questions. The model is told to aim for ~8–14; this is the backstop. */
const MAX_QUESTIONS = 20

// A single spoken answer can run long (a 5-minute monologue is ~5k chars).
// Clip rather than reject: a rejection would hand the client a Retry that can
// never succeed. The array cap is generous for the same reason; the terminal
// backstop below ends the interview well before it.
const MAX_MESSAGE_CHARS = 12_000
const MAX_TRANSCRIPT_MESSAGES = 2 * MAX_QUESTIONS + 20
const messageSchema = z.object({
  role: z.enum(["ai", "user"]),
  text: z
    .string()
    .trim()
    .transform((s) => s.slice(0, MAX_MESSAGE_CHARS)),
})
const inputSchema = z.object({
  transcript: z.array(messageSchema).max(MAX_TRANSCRIPT_MESSAGES),
})

const coverageSchema = z.object({
  business: z.boolean(),
  family: z.boolean(),
  personal: z.boolean(),
  coming_up: z.boolean(),
  vampire: z.boolean(),
  goal: z.boolean(),
  topic: z.boolean(),
  qol: z.boolean(),
})
const turnSchema = z.object({
  action: z.enum(["ask", "ready", "done"]),
  question: z.string(),
  coverage: coverageSchema,
  note: z.string(),
})

export type InterviewTurnResponse =
  | { ok: true; turn: InterviewTurnResult }
  | { ok: false; error: string }

const WRAPUP_FALLBACK =
  "I think I have what I need. Is there anything else you'd like to add, or shall I put your update together?"

// Below this count the model enters "compression" (essentials only, one per
// turn); at COMPRESS_AT + 4 it may no longer "ask", so the wrap-up is at most
// the MAX_QUESTIONS-th spoken line.
const COMPRESS_AT = MAX_QUESTIONS - 5
const NO_ASK_AT = MAX_QUESTIONS - 1

// Synthesized by a judge panel (three independent drafts, two judges, graft
// of the best ideas). The decision rules are ordered — first match wins — and
// the model is stateless: it re-derives coverage from the whole transcript on
// every turn, which is why the client just sends the full conversation.
const SYSTEM_PROMPT = `You are the interviewer behind "Interview me" in Cupcake, a YPO forum companion app. A member is starting a NEW monthly update by voice. You ask one short question at a time, read aloud by text-to-speech, and get their answer as a transcript. A separate step builds the update from only what they say here. Be the best forum moderator you've seen run a check-in: warm, curious, unhurried, direct. Not a survey, coach or therapist.

THE UPDATE NEEDS: Quality of Life numbers (physical, mental, financial, friends and community; one to ten). Business, Family, Personal: three to five feeling words, a one-sentence situation, three deepening whys (why it matters, the deeper why, the rawest truth). The biggest thing coming up next month plus feelings. One energy vampire (a person or thing draining them). One concrete goal. An optional forum topic. Never name the form or its parts aloud.

PRINCIPLES
- 5/5/90: the top and bottom five percent of life right now, not the ninety percent middle. Hear a status report, find the live wire: "Of all that, what's keeping you up at night, or lighting you up?"
- Feelings, then situation, then significance: the why beneath the why.
- The member is the author. Never propose feeling words, invent, recap, coach, advise, reassure, praise, diagnose or interpret. Asked for advice: "That's one for forum. What's your gut saying?" Asked to skip or speed up: do it.
- Depth before breadth: two or three follow-ups in an area, never four. "Nothing much on family" is a real answer: believe it, move on. Never fish, never fill a quiet area from last month.

VOICE ("question" is spoken verbatim)
One question per turn, under twenty words, never over thirty; only the Quality of Life snapshot and the wrap-up may be multi-part. Plain spoken English, contractions, numbers as words; no markdown, emoji, quotes, parentheses, colons or acronyms; match their language. Mirror their exact words. Acknowledge briefly, sometimes ("Okay." "That's a lot."); never "thanks for sharing," "I hear you," "that must be hard," "great," or a recap. First name in the opener, one pivot, and the wrap-up. Avoid a bare "why" aloud. Never narrate the process.

CRAFT
- Feeling: "What's the word for that?" A thought dressed as a feeling ("I feel like he isn't listening") gets "When he doesn't listen, what does that feel like in you?" Then once: "What else is mixed in with that?" If stuck: "If a close friend asked, what would you say?" Then take what they give.
- Situation: "What happened?"
- Significance, one rung per turn, a different question each. One: "What makes that matter so much right now?" Two, the stakes: "What would it mean about you if that happened?" Three, the raw truth: "What's the part you haven't said out loud yet?" For highs: "What were you afraid would never happen?" Stop when something raw lands, answers repeat, or they deflect. Rung three in one area, maybe two, never all three.

ARC (a shape, not a script)
1. Open wide on the highest high or lowest low across all of life, never a category or the numbers; if continuity shows something clearly unfinished, you may open there. Wherever they go, stay and go down.
2. Sweep the other two areas, one open question each ("And at home, what's the high or the low this month?"); one or two follow-ups if it lights up, accept thin at once.
3. Quality of Life, once: fold a number in where natural or take all four in one breath near the end. Each number at most once; accept words, infer clear signals, leave skips.
4. Closers, one short question each, often falling out of the hot area: coming up (follow with the feeling if it isn't clear); vampire; goal anchored to the hot item ("What's one thing you'll actually do about that, this week or this month?"). Topic once, late, only if there's room; any answer settles it.
5. Continuity (previous updates, when given): at most one or two questions, on an unfinished goal, lingering vampire, key situation or low score, in their earlier words. Never recite, pad or shame. Only what they say now counts.
6. Wrap-up, one line (Maya stands for their name): "I think I've got the real picture, Maya. Anything else you want in this update, or shall I put it together?"

READING THE MEMBER
"I don't know": one reframe, never two. Answers that belong elsewhere: follow and credit them, never redirect. Questions back, including "how much longer": answer honestly in a few words, then re-ask. Garbled transcript: "I didn't catch that. Say it again?" Once; never comment on transcription. Heavy disclosures (a diagnosis, a marriage ending, a death): be a human for one sentence, no advice or platitudes, then one gentle question and let them choose whether to go on; this is often the five percent. Safety: any sign of harm to themselves or others stops the interview. Say plainly this matters more than any update and they should reach out right now to someone they trust or emergency services, then ask whether to stop here or put together what they've given, as "ready".

DECISION RULES (stateless: re-read the whole transcript every turn, derive coverage from everything the member has said, never repeat a question; first match wins)
1. Safety concern in the latest line: "ready", as above; "done" on the next reply.
2. Explicit generate, out of time, or leaving ("just generate it", "write it up", "I'm out of time", "gotta run", "stop"): "done" if there is any substantive content; if none, "ready" with "No problem. One line on what's most on your mind, or shall I stop here?" and "done" on the next reply, whatever it says.
3. Soft done ("that's enough", "I'm done", "that covers it"): "ready".
4. After a "ready": read the reply against the exact wrap-up asked. Consent ("go ahead", "nothing else", "no"): "done". Ambiguous ("yes", "sure", "okay"): "ready" with "Is that a yes to putting it together, or is there more?" New material lacking a feeling or why, count below ${NO_ASK_AT}: one "ask", then a shorter "ready"; otherwise "ready". Asks to continue: ask. After three wrap-ups, the next reply is "done" unless they explicitly ask to continue.
5. Count ${NO_ASK_AT} or more: "ready", never "ask".
6. Readiness: business, family and personal each covered (a feeling, a situation, one why) or explicitly thin; at least one area at two or more rungs; a specific coming-up item; a concrete goal; vampire asked; Quality of Life asked once or volunteered. Topic never blocks. Return "ready"; typically eight to fourteen questions. Don't pad to the cap.
7. Count ${COMPRESS_AT} or more and not ready: compression. One question per turn for missing essentials only, in order: hot area's why, goal, coming up, vampire, Quality of Life. Skip topic. Reach "ready" within two or three turns.
8. Otherwise "ask" per the arc; on the first turn, the opener.

COVERAGE (cumulative, this conversation only, never from continuity; once true, stays true). business, family, personal: a feeling, a situation and one why, or declared quiet this month. coming_up: a specific thing named. vampire: named, or none. goal: something concrete (never ask for the horizon). topic: offered or declined; false if never asked. qol: all four asked or volunteered, even if some answers were vague.

OUTPUT CONTRACT (fixed; return exactly one JSON object, nothing else, no fences, no extra keys)
{
  "action": "ask" | "ready" | "done",
  "question": string,   // the spoken line for ask (the next question) or ready (the wrap-up question). Empty string for done.
  "coverage": { "business": bool, "family": bool, "personal": bool, "coming_up": bool, "vampire": bool, "goal": bool, "topic": bool, "qol": bool },
  "note": string        // one short private line of reasoning (never spoken); may be empty
}
- "ask": keep interviewing with this question. Never a wrap-up.
- "ready": you believe there is enough; "question" MUST be a wrap-up asking if there's anything else to add or whether to generate the update.
- "done": the member has confirmed (or explicitly asked to generate / is out of time and has given at least some content). "question" is exactly "". Generate now.
- All eight coverage keys always present, true or false, never null. "note" under twenty-five words, only what's in the transcript.

INPUTS: the member's first name; the conversation as alternating AI and member lines (voice transcripts); optional continuity context; the count of questions asked so far (asks and wrap-ups both count; if absent, count the AI lines).`

/**
 * The question is read aloud verbatim, so strip anything a TTS engine would
 * either voice literally ("asterisk") or choke on. The prompt forbids these;
 * this is the belt to its braces.
 */
function cleanSpoken(q: string): string {
  return q
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * One turn of the "Interview Me" conversation. Given everything said so far,
 * returns the next question, the wrap-up, or "done". Member-private: the only
 * extra context is the member's own last two finalized updates (RLS-scoped).
 */
export async function interviewTurn(input: {
  transcript: InterviewMessage[]
}): Promise<InterviewTurnResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI is not configured (missing ANTHROPIC_API_KEY)." }
  }

  const me = await requireCurrentMember()
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "This interview has run very long — tap Finish & generate to build your update from what you've said.",
    }
  }
  const transcript = parsed.data.transcript
  const questionsAsked = transcript.filter((m) => m.role === "ai").length
  const answersGiven = transcript.filter((m) => m.role === "user").length

  // Terminal backstop: once the cap has been reached AND a wrap-up has
  // already been asked and answered, generate regardless of what the member
  // just said. Without this, "one more thing…" could extend the conversation
  // forever (the ask→ready backstop alone never ends it).
  if (questionsAsked > NO_ASK_AT && answersGiven > 0 && transcript[transcript.length - 1]?.role === "user") {
    return {
      ok: true,
      turn: {
        action: "done",
        question: "",
        coverage: { business: true, family: true, personal: true, coming_up: true, vampire: true, goal: true, topic: false, qol: true },
        note: "Cap reached after wrap-up; generating.",
      },
    }
  }

  // Continuity context: the member's last two finalized updates, compacted.
  const supabase = await createClient()
  const { data: past } = await supabase
    .from("updates")
    .select("content, completed_at")
    .eq("member_id", me.id)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(2)

  const continuity = (past ?? [])
    .map((u) => {
      const c = u.content as Record<string, unknown> | null
      if (!c) return null
      const sec = (k: string) => (c[k] as { situation?: string } | undefined)?.situation ?? ""
      return {
        date: u.completed_at?.slice(0, 10) ?? "",
        qol: c.qol ?? null,
        business: sec("business"),
        family: sec("family"),
        personal: sec("personal"),
        vampire: (c.energy_vampire as string | undefined) ?? "",
        goal: (c.goal as { text?: string } | undefined)?.text ?? "",
        topic: (c.topic as { text?: string } | undefined)?.text ?? "",
      }
    })
    .filter(Boolean)

  const firstName = me.name.split(" ")[0]
  const convo =
    transcript.length === 0
      ? "No questions asked yet. Open the interview."
      : transcript
          .map((m) => `${m.role === "ai" ? "AI" : firstName}: ${m.text}`)
          .join("\n")

  const userPrompt = `Member: ${firstName}
Questions asked so far (asks and wrap-ups): ${questionsAsked} (cap ${MAX_QUESTIONS})
${
  continuity.length
    ? `\nContinuity context — ${firstName}'s most recent finalized updates (use sparingly, for at most one or two questions):\n${JSON.stringify(continuity, null, 2)}\n`
    : ""
}
Conversation so far:
${convo}

Decide the next turn and return the JSON.`

  // One retry only: the SDK honours a server retry-after sleep that the abort
  // signal can't interrupt, so maxRetries 3 could outlive the page's 120s
  // maxDuration. For a conversational turn a long wait is worse than a quick
  // "tap Retry" anyway.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 1,
    timeout: 50_000,
  })

  try {
    const response = await client.messages.create(
      {
        model: AI_MODEL,
        // A single short question + a small coverage object; 2048 leaves
        // adaptive thinking room without risking truncation.
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        output_config: {
          // This is a spoken back-and-forth: every second of "Thinking…"
          // between questions is dead air. Low effort halves turn latency
          // (~4s vs ~8s in simulation) with no measurable loss in question
          // quality; the one-shot generation step keeps the default effort.
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["ask", "ready", "done"] },
                question: { type: "string" },
                coverage: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    business: { type: "boolean" },
                    family: { type: "boolean" },
                    personal: { type: "boolean" },
                    coming_up: { type: "boolean" },
                    vampire: { type: "boolean" },
                    goal: { type: "boolean" },
                    topic: { type: "boolean" },
                    qol: { type: "boolean" },
                  },
                  required: [
                    "business", "family", "personal", "coming_up",
                    "vampire", "goal", "topic", "qol",
                  ],
                },
                note: { type: "string" },
              },
              required: ["action", "question", "coverage", "note"],
            },
          },
        },
      },
      // Overall deadline across retries, under the page's 120s maxDuration.
      { signal: AbortSignal.timeout(110_000) }
    )

    if (response.stop_reason === "max_tokens") {
      console.warn("[interview] response truncated at max_tokens", { member: me.id })
      return { ok: false, error: "That answer got cut off on my side. Could you say it again?" }
    }
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[interview] no text block", { member: me.id, stop_reason: response.stop_reason })
      return { ok: false, error: "I lost the thread for a second. Let's try that again." }
    }

    const turn = turnSchema.parse(JSON.parse(textBlock.text))

    // Deterministic backstops regardless of what the model decided.
    let action = turn.action
    let question = cleanSpoken(turn.question)
    // Mirrors decision rule 5: no new question once the wrap-up would be
    // the last allowed line.
    if (action === "ask" && questionsAsked >= NO_ASK_AT) {
      action = "ready"
      question = WRAPUP_FALLBACK
    }
    if (action !== "done" && question.length === 0) {
      question = action === "ready" ? WRAPUP_FALLBACK : "What's been most on your mind this month?"
    }
    if (action === "done" && transcript.filter((m) => m.role === "user").length === 0) {
      // Nothing to generate from yet — keep interviewing.
      action = "ask"
      question = "Before I put anything together — what's been most alive for you this month?"
    }

    await supabase.from("ai_interactions").insert({
      member_id: me.id,
      kind: "interview_turn",
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    })

    const coverage: InterviewCoverage = turn.coverage
    return { ok: true, turn: { action, question, coverage, note: turn.note } }
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
      console.error("[interview] timeout", { member: me.id })
      return { ok: false, error: "That took too long. Tap Retry to try again." }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error("[interview] connection error", { member: me.id, message: err.message })
      return { ok: false, error: "Couldn't reach the AI. Check your connection and tap Retry." }
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[interview] Anthropic APIError", {
        member: me.id, status: err.status, name: err.name, message: err.message,
      })
      if (err.status === 429 || err.status === 529) {
        return { ok: false, error: "The AI is busy right now. Give it a few seconds and tap Retry." }
      }
      return { ok: false, error: "The AI had a hiccup. Tap Retry." }
    }
    console.error("[interview] non-API error", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: "Something went wrong on my side. Tap Retry." }
  }
}
