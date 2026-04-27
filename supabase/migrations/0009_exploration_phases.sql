-- Cupcake — Format-aware Exploration phases
-- Extends meeting_rounds to track which exploration format is running, which
-- phase within it is active, and links the round to a parking-lot item.

alter type round_type add value if not exists 'exploration';

alter table meeting_rounds
  add column if not exists exploration_format exploration_format_code,
  add column if not exists parking_lot_item_id uuid references parking_lot_items(id) on delete set null,
  add column if not exists phase_index int not null default 0,
  add column if not exists phase_started_at timestamptz;
