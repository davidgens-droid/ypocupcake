-- Cupcake — AI pattern cards
-- One row per surfaced pattern, member-private. Regenerated when a member
-- finalizes a new update; cards persist (not regenerated on every dashboard
-- load) so the dashboard is fast.

create table ai_pattern_cards (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  title text not null,
  detail text not null,
  topic_suggestion text,                  -- optional one-liner for the parking-lot CTA
  source_update_count int not null,       -- cache invalidator: regen when this changes
  generated_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index ai_pattern_cards_member_idx
  on ai_pattern_cards(member_id, source_update_count)
  where dismissed_at is null;

alter table ai_pattern_cards enable row level security;

create policy ai_pattern_cards_self_only on ai_pattern_cards
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());
