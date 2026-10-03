import { NextResponse } from "next/server"

import { getCurrentMember } from "@/lib/auth/current-member"

export const runtime = "nodejs"
export const maxDuration = 30

// Interview questions are under thirty words; the wrap-up and the safety line
// are the longest things ever spoken. Anything bigger isn't a question.
const MAX_CHARS = 600
const DEFAULT_VOICE = "nova"
const VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
])

// How the interviewer should sound. Steers gpt-4o-mini-tts; ignored by the
// older tts-1 models if someone swaps the model via env.
const INSTRUCTIONS =
  "You are a warm, unhurried interviewer sitting across a table from a friend. " +
  "Speak naturally and conversationally with gentle curiosity — never brisk, never performative. " +
  "Let questions land softly; a small pause at commas and before the question mark."

/**
 * Voices one interviewer line with OpenAI's neural TTS. Member-only; the
 * client falls back to the browser's speechSynthesis when this returns 501
 * (no key configured) or fails.
 *
 * Privacy note: only the interviewer's question text reaches OpenAI — never
 * the member's answers — but questions mirror the member's own words, so the
 * interview UI discloses that questions are voiced by OpenAI.
 */
export async function POST(req: Request) {
  const me = await getCurrentMember()
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 })

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return NextResponse.json({ error: "Natural voice is not configured." }, { status: 501 })

  let text = ""
  try {
    const body = (await req.json()) as { text?: unknown }
    text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : ""
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 })
  }
  if (!text || text.length > MAX_CHARS) {
    return NextResponse.json({ error: "Nothing to say, or too long." }, { status: 400 })
  }

  const voiceEnv = process.env.OPENAI_TTS_VOICE?.trim()
  const voice = voiceEnv && VOICES.has(voiceEnv) ? voiceEnv : DEFAULT_VOICE
  const model = process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts"

  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        instructions: INSTRUCTIONS,
        response_format: "mp3",
      }),
      // A question is a few seconds of audio; anything slower than this and
      // the browser voice is the better experience.
      signal: AbortSignal.timeout(15_000),
    })
    if (!upstream.ok || !upstream.body) {
      // Status only — never the text.
      console.error("[tts] upstream error", { status: upstream.status, member: me.id })
      return NextResponse.json({ error: "Voice service error." }, { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[tts] request failed", {
      member: me.id,
      name: err instanceof Error ? err.name : typeof err,
    })
    return NextResponse.json({ error: "Voice service unreachable." }, { status: 502 })
  }
}
