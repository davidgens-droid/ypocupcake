import { z } from "zod"

// Mirrors the YPO Update Form. Stored as `updates.content` JSONB (legacy)
// or, encrypted, as `updates.content_enc`.

const HORIZONS = ["day", "week", "month"] as const
const URGENCIES = ["low", "med", "high"] as const
const TOOL_CATEGORIES = ["EQ", "IQ"] as const

/**
 * The schema in two strengths. `limits: true` is what the builder, the AI
 * and every save enforce (field lengths included). `limits: false` is the
 * same shape without the length caps, used only to READ what is already
 * stored, so a past update is never refused or truncated on its way into
 * an envelope.
 */
function makeReflectionSchema(limits: boolean) {
  const str = (max: number) => (limits ? z.string().max(max) : z.string())
  return z.object({
    feelings: limits ? z.array(z.string().min(1).max(40)).min(0).max(5) : z.array(z.string()),
    situation: str(280).default(""),
    significance: z.tuple([str(500).default(""), str(500).default(""), str(500).default("")]),
  })
}

function makeUpdateContentSchema(limits: boolean) {
  const str = (max: number) => (limits ? z.string().max(max) : z.string())
  const reflection = makeReflectionSchema(limits)
  return z.object({
    qol: z.object({
      physical_health: z.number().int().min(1).max(10).default(5),
      mental_health: z.number().int().min(1).max(10).default(5),
      financial_health: z.number().int().min(1).max(10).default(5),
      friends_community: z.number().int().min(1).max(10).default(5),
    }),
    business: reflection,
    family: reflection,
    personal: reflection,
    coming_up: z.object({
      text: str(500).default(""),
      feelings: (limits ? z.array(z.string().min(1).max(40)).max(3) : z.array(z.string())).default([]),
    }),
    energy_vampire: str(280).default(""),
    goal: z.object({
      text: str(500).default(""),
      horizon: z.enum(HORIZONS).default("week"),
      make_commitment: z.boolean().default(false),
    }),
    topic: z.object({
      text: str(500).default(""),
      publish_to_parking_lot: z.boolean().default(false),
      context: str(2000).default(""),
      urgency: z.enum(URGENCIES).default("med"),
      tool_category: z.enum(TOOL_CATEGORIES).default("EQ"),
      exploration_format: z.string().default("fsfe"),
    }),
  })
}

export const reflectionSchema = makeReflectionSchema(true)
export type Reflection = z.infer<typeof reflectionSchema>

export const updateContentSchema = makeUpdateContentSchema(true)
export type UpdateContent = z.infer<typeof updateContentSchema>

/** Same shape, no length caps: for reading what is already stored. */
const storedUpdateContentSchema = makeUpdateContentSchema(false)

export const emptyUpdateContent: UpdateContent = updateContentSchema.parse({
  qol: {},
  business: { feelings: [], situation: "", significance: ["", "", ""] },
  family: { feelings: [], situation: "", significance: ["", "", ""] },
  personal: { feelings: [], situation: "", significance: ["", "", ""] },
  coming_up: {},
  goal: {},
  topic: {},
})

// ── reading stored updates ───────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
const words = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [])
const score = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : 5
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

function normalizeReflection(v: unknown) {
  const o = isObj(v) ? v : {}
  const sig = Array.isArray(o.significance) ? o.significance : []
  return {
    feelings: words(o.feelings),
    situation: text(o.situation),
    significance: [text(sig[0]), text(sig[1]), text(sig[2])] as [string, string, string],
  }
}

/**
 * Bring any stored update, however old or partial, into today's shape
 * without dropping text: missing parts get their defaults, scores are
 * clamped to 1–10, and nothing is truncated. Unknown keys are ignored.
 */
export function normalizeStoredUpdate(raw: unknown): UpdateContent {
  const o = isObj(raw) ? raw : {}
  const qol = isObj(o.qol) ? o.qol : {}
  const comingUp = isObj(o.coming_up) ? o.coming_up : {}
  const goal = isObj(o.goal) ? o.goal : {}
  const topic = isObj(o.topic) ? o.topic : {}
  return storedUpdateContentSchema.parse({
    qol: {
      physical_health: score(qol.physical_health),
      mental_health: score(qol.mental_health),
      financial_health: score(qol.financial_health),
      friends_community: score(qol.friends_community),
    },
    business: normalizeReflection(o.business),
    family: normalizeReflection(o.family),
    personal: normalizeReflection(o.personal),
    coming_up: { text: text(comingUp.text), feelings: words(comingUp.feelings) },
    energy_vampire: text(o.energy_vampire),
    goal: {
      text: text(goal.text),
      horizon: oneOf(goal.horizon, HORIZONS, "week"),
      make_commitment: goal.make_commitment === true,
    },
    topic: {
      text: text(topic.text),
      publish_to_parking_lot: topic.publish_to_parking_lot === true,
      context: text(topic.context),
      urgency: oneOf(topic.urgency, URGENCIES, "med"),
      tool_category: oneOf(topic.tool_category, TOOL_CATEGORIES, "EQ"),
      exploration_format: text(topic.exploration_format) || "fsfe",
    },
  })
}

/**
 * Parse a stored update for display or migration: exactly as saved when it
 * still fits today's schema, otherwise normalised (see above). Returns null
 * only for something that isn't an update at all (not an object).
 */
export function parseStoredUpdate(raw: unknown): UpdateContent | null {
  const strict = updateContentSchema.safeParse(raw)
  if (strict.success) return strict.data
  if (!isObj(raw)) return null
  try {
    return normalizeStoredUpdate(raw)
  } catch {
    return null
  }
}

/**
 * True when an update has nothing the member actually entered — every text
 * field blank, no feelings, and QoL still at the untouched default of 5s.
 * Used to decide whether a brain-dump should CREATE (fresh) or REFINE
 * (fold new thoughts into what's already there).
 */
export function isEmptyUpdate(c: UpdateContent): boolean {
  const sectionEmpty = (s: Reflection) =>
    s.feelings.length === 0 &&
    !s.situation.trim() &&
    s.significance.every((x) => !x.trim())
  const qolUntouched = Object.values(c.qol).every((v) => v === 5)
  return (
    qolUntouched &&
    sectionEmpty(c.business) &&
    sectionEmpty(c.family) &&
    sectionEmpty(c.personal) &&
    !c.coming_up.text.trim() &&
    c.coming_up.feelings.length === 0 &&
    !c.energy_vampire.trim() &&
    !c.goal.text.trim() &&
    !c.topic.text.trim() &&
    !c.topic.context.trim()
  )
}

export const FEELING_SUGGESTIONS = [
  "Energized",
  "Frustrated",
  "Hopeful",
  "Anxious",
  "Proud",
  "Drained",
  "Curious",
  "Grateful",
  "Restless",
  "Confident",
  "Stuck",
  "Excited",
  "Apprehensive",
  "Tense",
  "Calm",
  "Overwhelmed",
  "Resentful",
  "Inspired",
  "Lonely",
  "Connected",
] as const
