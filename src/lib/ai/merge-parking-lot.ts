// Imported only by server actions in @/lib/parking-lot/actions (a "use server"
// module), so the Anthropic SDK never reaches the client bundle.
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { FORMAT_PHASES } from "@/lib/meetings/exploration-phases"

const FORMAT_CODES = Object.keys(FORMAT_PHASES)

export type MergeItemInput = {
  topic: string
  context: string | null
  urgency: "low" | "med" | "high"
  tool_category: "EQ" | "IQ"
  exploration_format: string
}

export type MergedFields = {
  topic: string
  context: string | null
  urgency: "low" | "med" | "high"
  tool_category: "EQ" | "IQ"
  exploration_format: string
}

const mergedSchema = z.object({
  topic: z.string().min(1).max(500),
  context: z.string().max(2000),
  urgency: z.enum(["low", "med", "high"]),
  tool_category: z.enum(["EQ", "IQ"]),
  exploration_format: z.string(),
})

/**
 * Ask Claude to merge a newly-captured parking-lot topic into an existing parked
 * one — producing the updated parked item that combines both. Returns null on
 * any failure (missing key, truncation, parse error) so the caller can fall back
 * to a deterministic merge and never block the meeting wrap-up.
 */
export async function mergeParkingLotItemsAI(
  captured: MergeItemInput,
  target: MergeItemInput
): Promise<MergedFields | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,
    timeout: 55_000,
  })

  const systemPrompt = `You merge two YPO forum "parking lot" topics into one.

You're given an EXISTING parked topic and a NEWLY captured topic that the
moderator wants folded into it. Produce the updated version of the EXISTING topic
that combines the substance of both — keep it one coherent topic, don't just
concatenate. Preserve any specific detail worth keeping from either side.

Rules:
- topic: one clear sentence/title for the combined topic.
- context: combined supporting detail. May be empty string if neither had any.
- urgency: take the higher of the two (high > med > low).
- tool_category: "EQ" (emotional/personal) or "IQ" (business/intellectual) —
  pick whichever best fits the merged topic.
- exploration_format: choose the most fitting code from this list: ${FORMAT_CODES.join(", ")}.

Be faithful to what the members actually wrote — do not invent new themes.`

  const userPrompt = `EXISTING parked topic:
${JSON.stringify(
    {
      topic: target.topic,
      context: target.context ?? "",
      urgency: target.urgency,
      tool_category: target.tool_category,
      exploration_format: target.exploration_format,
    },
    null,
    2
  )}

NEWLY captured topic to merge in:
${JSON.stringify(
    {
      topic: captured.topic,
      context: captured.context ?? "",
      urgency: captured.urgency,
      tool_category: captured.tool_category,
      exploration_format: captured.exploration_format,
    },
    null,
    2
  )}

Return the merged topic.`

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
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
              topic: { type: "string" },
              context: { type: "string" },
              urgency: { type: "string", enum: ["low", "med", "high"] },
              tool_category: { type: "string", enum: ["EQ", "IQ"] },
              exploration_format: { type: "string", enum: FORMAT_CODES },
            },
            required: [
              "topic",
              "context",
              "urgency",
              "tool_category",
              "exploration_format",
            ],
          },
        },
      },
    })

    if (response.stop_reason === "max_tokens") return null
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") return null

    const parsed = mergedSchema.safeParse(JSON.parse(textBlock.text))
    if (!parsed.success) return null

    const fmt = FORMAT_CODES.includes(parsed.data.exploration_format)
      ? parsed.data.exploration_format
      : target.exploration_format

    return {
      topic: parsed.data.topic.slice(0, 500),
      context: parsed.data.context.trim() ? parsed.data.context.slice(0, 2000) : null,
      urgency: parsed.data.urgency,
      tool_category: parsed.data.tool_category,
      exploration_format: fmt,
    }
  } catch (err) {
    console.error("[merge-parking-lot] AI merge failed", {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
