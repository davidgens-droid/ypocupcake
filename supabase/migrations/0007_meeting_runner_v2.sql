-- Cupcake — Meeting Runner v2
-- Adds per-member timer state to rounds and enables Supabase Realtime so
-- member views auto-flip without manual refresh.

-- ──────────────────────────────────────────────────────────────────────────
-- Timer columns
-- ──────────────────────────────────────────────────────────────────────────
alter table meeting_rounds
  add column if not exists per_member_seconds int not null default 300,
  add column if not exists current_started_at timestamptz;

-- ──────────────────────────────────────────────────────────────────────────
-- Enable Realtime for the tables clients subscribe to
-- ──────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table meetings;
alter publication supabase_realtime add table meeting_rounds;
alter publication supabase_realtime add table attendees;

-- ──────────────────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL on meeting_rounds so UPDATE events broadcast the new
-- row (default identity only includes the PK columns).
-- ──────────────────────────────────────────────────────────────────────────
alter table meeting_rounds replica identity full;
alter table meetings replica identity full;
alter table attendees replica identity full;
