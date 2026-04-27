import { z } from "zod"

// Mirrors the YPO Update Form. Stored as `updates.content` JSONB.

export const reflectionSchema = z.object({
  feelings: z
    .array(z.string().min(1).max(40))
    .min(0)
    .max(5),
  situation: z.string().max(280).default(""),
  significance: z.tuple([
    z.string().max(500).default(""),
    z.string().max(500).default(""),
    z.string().max(500).default(""),
  ]),
})

export type Reflection = z.infer<typeof reflectionSchema>

export const updateContentSchema = z.object({
  qol: z.object({
    physical_health: z.number().int().min(1).max(10).default(5),
    mental_health: z.number().int().min(1).max(10).default(5),
    financial_health: z.number().int().min(1).max(10).default(5),
    friends_community: z.number().int().min(1).max(10).default(5),
  }),
  business: reflectionSchema,
  family: reflectionSchema,
  personal: reflectionSchema,
  coming_up: z.object({
    text: z.string().max(500).default(""),
    feelings: z.array(z.string().min(1).max(40)).max(3).default([]),
  }),
  energy_vampire: z.string().max(280).default(""),
  goal: z.object({
    text: z.string().max(500).default(""),
    horizon: z.enum(["day", "week", "month"]).default("week"),
    make_commitment: z.boolean().default(false),
  }),
  topic: z.object({
    text: z.string().max(500).default(""),
    publish_to_parking_lot: z.boolean().default(false),
    context: z.string().max(2000).default(""),
    urgency: z.enum(["low", "med", "high"]).default("med"),
    tool_category: z.enum(["EQ", "IQ"]).default("EQ"),
    exploration_format: z.string().default("fsfe"),
  }),
})

export type UpdateContent = z.infer<typeof updateContentSchema>

export const emptyUpdateContent: UpdateContent = updateContentSchema.parse({
  qol: {},
  business: { feelings: [], situation: "", significance: ["", "", ""] },
  family: { feelings: [], situation: "", significance: ["", "", ""] },
  personal: { feelings: [], situation: "", significance: ["", "", ""] },
  coming_up: {},
  goal: {},
  topic: {},
})

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
