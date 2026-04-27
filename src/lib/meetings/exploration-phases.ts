// Format-aware Exploration phase definitions.
// Source: Hesse Partners "Forum Tools Moderator Guide 2025"

import type { ExplorationFormatCode } from "@/lib/types/domain"

export type PhaseDef = {
  name: string
  default_seconds: number
  /** Phase iterates through members one-by-one with a hidden random order. */
  has_round: boolean
  /** When true, the parking-lot submitter is excluded from the round
   *  (e.g. FSFE Experience Sharing — the presenter receives, doesn't share). */
  excludes_presenter?: boolean
  description: string
  moderator_note?: string
}

export const FORMAT_PHASES: Record<ExplorationFormatCode, PhaseDef[]> = {
  fsfe: [
    {
      name: "Presentation",
      default_seconds: 600,
      has_round: false,
      description: "Member presents their topic, question, and journey as a gift.",
      moderator_note: "No interruptions. Listen with curiosity, respect, and compassion.",
    },
    {
      name: "Clarifying Questions",
      default_seconds: 600,
      has_round: false,
      description: "Open Q&A — clarifying questions only, no advice.",
    },
    {
      name: "Experience Sharing",
      default_seconds: 1800,
      has_round: true,
      excludes_presenter: true,
      description: "Each member shares one resonant experience. ~3 min each.",
      moderator_note: "No advice or fixing. Resonate, don't repair.",
    },
    {
      name: "Member Reflection",
      default_seconds: 600,
      has_round: false,
      description: "Presenter reflects on what landed and what they'll take away.",
    },
  ],
  blind_window: [
    {
      name: "Member presents",
      default_seconds: 180,
      has_round: false,
      description: "Member shares the situation in 3 minutes.",
    },
    {
      name: "Forum shares feedback",
      default_seconds: 600,
      has_round: true,
      excludes_presenter: true,
      description:
        "Member turns their back. Forum members share blind-window observations.",
      moderator_note:
        "Observations only — no advice. Recommended for forums who know each other well.",
    },
    {
      name: "Member rejoins",
      default_seconds: 120,
      has_round: false,
      description: "Member rejoins and shares any insights or thoughts.",
    },
  ],
  connection: [
    {
      name: "Setup",
      default_seconds: 300,
      has_round: false,
      description: "Moderator introduces the exercise; distribute any worksheets.",
    },
    {
      name: "Individual / pair work",
      default_seconds: 600,
      has_round: false,
      description: "Members complete worksheets, work in pairs or small groups.",
    },
    {
      name: "Whole group share",
      default_seconds: 600,
      has_round: false,
      description: "Group share or debrief, as the exercise design dictates.",
    },
  ],
  lightning_round: [
    {
      name: "Lightning round",
      default_seconds: 60,
      has_round: true,
      description: "Each member <1 minute. No Q&A or discussion.",
    },
  ],
  brainstorm: [
    {
      name: "Frame question",
      default_seconds: 120,
      has_round: false,
      description: "Moderator quickly frames the question.",
    },
    {
      name: "Silent ideation",
      default_seconds: 60,
      has_round: false,
      description: "Everyone writes ideas silently for 1 minute.",
    },
    {
      name: "One idea per member",
      default_seconds: 60,
      has_round: true,
      description: "Each member shares one idea from their notes.",
    },
    {
      name: "Open popcorn",
      default_seconds: 300,
      has_round: false,
      description: "Open floor — popcorn ideas, original and generative.",
      moderator_note: "No debate or judgment.",
    },
  ],
  topical_discussion: [
    {
      name: "Frame",
      default_seconds: 180,
      has_round: false,
      description: "Moderator introduces the topic and sets focus and boundaries.",
    },
    {
      name: "Discussion",
      default_seconds: 1500,
      has_round: false,
      description: "Moderated discussion — directed at the topic, not any one member.",
      moderator_note: "Don't debate, politic, or preach.",
    },
    {
      name: "Take-home round",
      default_seconds: 60,
      has_round: true,
      description: "Each member shares their take-home value.",
    },
  ],
  needs_and_leads: [
    {
      name: "Needs",
      default_seconds: 60,
      has_round: true,
      description:
        "Each member makes a specific request to the group (a question, a connection, etc.).",
    },
    {
      name: "Leads",
      default_seconds: 60,
      has_round: true,
      description:
        "Each member shares leads for others' benefit (vendors, suppliers, clients).",
    },
  ],
  learning_exchange: [
    {
      name: "Framing",
      default_seconds: 300,
      has_round: false,
      description: "Lead member provides framing and focus for the discussion.",
    },
    {
      name: "Member takeaways",
      default_seconds: 60,
      has_round: true,
      description: "Each member summarizes what they learned or are pondering.",
    },
    {
      name: "Discussion",
      default_seconds: 600,
      has_round: false,
      description: "Open group discussion on the content.",
    },
  ],
  internal_expert: [
    {
      name: "Presentation",
      default_seconds: 750,
      has_round: false,
      description: "Member presents their expertise (10–15 min, with visuals if useful).",
    },
    {
      name: "Q&A",
      default_seconds: 900,
      has_round: false,
      description: "Moderated Q&A.",
    },
    {
      name: "Take-home round",
      default_seconds: 60,
      has_round: true,
      description: "Each member shares one take-home or learning.",
    },
  ],
  external_expert: [
    {
      name: "Speaker intro & talk",
      default_seconds: 900,
      has_round: false,
      description: "Introduce the speaker; ~15 min talk.",
    },
    {
      name: "Q&A",
      default_seconds: 900,
      has_round: false,
      description: "Lively, engaging Q&A — take detailed/specific questions offline.",
    },
    {
      name: "Debrief round",
      default_seconds: 60,
      has_round: true,
      description: "Each member shares a debrief or experience.",
    },
  ],
}

export function getPhases(format: ExplorationFormatCode | null | undefined) {
  if (!format) return []
  return FORMAT_PHASES[format] ?? []
}

export function getCurrentPhase(
  format: ExplorationFormatCode | null | undefined,
  phaseIndex: number
): PhaseDef | null {
  const phases = getPhases(format)
  return phases[phaseIndex] ?? null
}
