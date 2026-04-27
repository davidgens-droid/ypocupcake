// Mock data shaped like real domain types so we can develop UI before
// Supabase is provisioned. Each export will be replaced with a Supabase
// query once the database is live.

import type { Member } from "@/lib/types/domain"

export const mockCurrentMember: Member & { is_admin: boolean } = {
  id: "00000000-0000-0000-0000-000000000001",
  forum_id: "00000000-0000-0000-0000-0000000000ff",
  email: "david.gens@merchantgrowth.com",
  name: "David Gens",
  photo_url: null,
  family: { partner: "Alex", children: ["Tess", "Liam"] },
  birthday: "1980-03-08",
  anniversary: null,
  is_admin: true,
}

export const mockNextMeeting = {
  id: "meet-1",
  scheduled_at: "2026-04-29T22:00:00.000Z", // 6pm local in MM-DD format
  location: "Bryan's home",
  host_name: "Bryan",
  has_update: false,
  is_ready: false,
}

export const mockOpenCommitments = [
  {
    id: "c1",
    text: "Tell my board I'm taking the September sabbatical",
    due_date: "2026-09-15",
    overdue: false,
  },
  {
    id: "c2",
    text: "Cut Slack hours after 8pm",
    due_date: "2026-04-25",
    overdue: true,
  },
]

export const mockPatternCard = {
  title: "Mental Health has trended down 4 months running",
  detail:
    "Your last four QoL snapshots show a consistent dip. Worth exploring as a topic, or surfacing in your next update.",
}

export const mockForumActivity = [
  { id: "a1", who: "Sarah", what: "posted 4 photos", when: "2h" },
  { id: "a2", who: "Marco", what: "parked a new topic", when: "1d" },
  { id: "a3", who: "Jen", what: "completed a commitment", when: "2d" },
]
