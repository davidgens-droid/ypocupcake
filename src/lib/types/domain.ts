// Domain-level types for Cupcake. These mirror the V1 spec data model;
// once Supabase is provisioned we can replace or augment with generated types
// via `supabase gen types typescript`.

export type RoleType =
  | "moderator"
  | "assistant_moderator"
  | "czar"
  | "host"
  | "admin"

export type Forum = {
  id: string
  name: string
  created_at: string
  settings: Record<string, unknown>
}

export type Member = {
  id: string
  forum_id: string
  email: string
  name: string
  photo_url: string | null
  family: { partner?: string; children?: string[] } | null
  birthday: string | null
  anniversary: string | null
}

// QoL fields on the Update mirror the YPO Update Form.
export type QoLSnapshot = {
  physical_health: number
  mental_health: number
  financial_health: number
  friends_community: number
}

export type ReflectionSection = {
  feelings: string[] // 3-5 words
  situation: string // one sentence (soft warn at 200, hard limit 280)
  significance: [string, string, string] // three layers of "why"
}

export type UpdateContent = {
  qol: QoLSnapshot
  business: ReflectionSection
  family: ReflectionSection
  personal: ReflectionSection
  coming_up: { text: string; feelings: string[] }
  energy_vampire: string
  goal: { text: string; horizon: "day" | "week" | "month" }
  topic: {
    text: string
    publish_to_parking_lot: boolean
    tool_category?: "EQ" | "IQ"
    exploration_format?: ExplorationFormatCode
  }
}

export type ExplorationFormatCode =
  // EQ
  | "fsfe"
  | "blind_window"
  | "connection"
  // IQ
  | "lightning_round"
  | "brainstorm"
  | "topical_discussion"
  | "needs_and_leads"
  | "learning_exchange"
  | "internal_expert"
  | "external_expert"

export type ExplorationFormat = {
  code: ExplorationFormatCode
  category: "EQ" | "IQ"
  display_name: string
  default_minutes: number
  short_description: string
  moderator_instructions: string
  source_attribution: string
}

export type ParkingLotStatus =
  | "parked"
  | "scheduled"
  | "presented"
  | "archived"
  | "withdrawn"

export type ParkingLotItem = {
  id: string
  forum_id: string
  submitter_member_id: string
  added_by_member_id: string
  topic: string
  context: string | null
  urgency: "low" | "med" | "high"
  tool_category: "EQ" | "IQ"
  exploration_format: ExplorationFormatCode
  status: ParkingLotStatus
  scheduled_meeting_id: string | null
  presented_at: string | null
  takeaways: string | null
  created_at: string
}

export type CommitmentStatus = "open" | "done" | "carried_over" | "dropped"

export type Commitment = {
  id: string
  forum_id: string
  member_id: string
  meeting_id: string | null
  text: string
  due_date: string | null
  status: CommitmentStatus
  notes: string | null
  updated_at: string
  created_at: string
}
