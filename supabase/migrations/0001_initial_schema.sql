-- Cupcake — initial schema (V1)
-- Single-tenant for now; schema is multi-tenant-ready via forum_id throughout.
-- See docs/v1-spec.md sections 6 & 7 for the source of truth.

-- ──────────────────────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────────────────────────────────
create type role_type as enum (
  'moderator', 'assistant_moderator', 'czar', 'host', 'admin'
);

create type tool_category as enum ('EQ', 'IQ');

create type exploration_format_code as enum (
  'fsfe', 'blind_window', 'connection',
  'lightning_round', 'brainstorm', 'topical_discussion',
  'needs_and_leads', 'learning_exchange',
  'internal_expert', 'external_expert'
);

create type urgency as enum ('low', 'med', 'high');

create type parking_lot_status as enum (
  'parked', 'scheduled', 'presented', 'archived', 'withdrawn'
);

create type meeting_status as enum (
  'upcoming', 'in_progress', 'closed', 'cancelled'
);

create type commitment_status as enum (
  'open', 'done', 'carried_over', 'dropped'
);

create type round_type as enum (
  'updates', 'experience_sharing', 'commitments', 'lightning', 'brainstorm', 'needs_and_leads'
);

create type agenda_kind as enum (
  'check_in', 'updates', 'parking_lot_item', 'commitments', 'wrap', 'custom'
);

-- ──────────────────────────────────────────────────────────────────────────
-- Forums
-- ──────────────────────────────────────────────────────────────────────────
create table forums (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now(),
  settings jsonb not null default '{}'::jsonb
);

-- ──────────────────────────────────────────────────────────────────────────
-- Members
-- One row per member; id is the supabase auth.users.id so RLS can match auth.uid().
-- ──────────────────────────────────────────────────────────────────────────
create table members (
  id uuid primary key references auth.users(id) on delete cascade,
  forum_id uuid not null references forums(id) on delete cascade,
  email text not null,
  name text not null,
  photo_url text,
  family jsonb,
  birthday date,
  anniversary date,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create index members_forum_id_idx on members(forum_id);

-- Annual roles (multiple per member possible, e.g. host + moderator).
create table roles (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  role_type role_type not null,
  year int not null,
  created_at timestamptz not null default now(),
  unique (forum_id, member_id, role_type, year)
);
create index roles_forum_year_idx on roles(forum_id, year);

-- ──────────────────────────────────────────────────────────────────────────
-- Helper function: forum of the calling member
-- ──────────────────────────────────────────────────────────────────────────
create or replace function current_member_forum() returns uuid
language sql stable security definer
set search_path = public
as $$
  select forum_id from members where id = auth.uid()
$$;

create or replace function has_role(p_role role_type) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from roles
    where member_id = auth.uid()
      and role_type = p_role
      and year = extract(year from now())
  )
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Meetings & attendance
-- ──────────────────────────────────────────────────────────────────────────
create table meetings (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  scheduled_at timestamptz not null,
  host_member_id uuid references members(id),
  location text,
  status meeting_status not null default 'upcoming',
  charter_snapshot text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index meetings_forum_idx on meetings(forum_id, scheduled_at desc);

create table attendees (
  meeting_id uuid not null references meetings(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  attending boolean not null default true,
  ready boolean not null default false,
  ready_at timestamptz,
  primary key (meeting_id, member_id)
);

-- Agenda items per meeting; covers built-in and custom items.
create table agenda_items (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  kind agenda_kind not null,
  parking_lot_item_id uuid,
  title text not null,
  notes text,
  time_allocation_min int,
  position int not null,
  status text not null default 'pending'
);
create index agenda_items_meeting_idx on agenda_items(meeting_id, position);

-- Round state (random order, current index, lifecycle)
create table meeting_rounds (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  agenda_item_id uuid references agenda_items(id) on delete cascade,
  round_type round_type not null,
  order_member_ids uuid[] not null,
  current_index int not null default 0,
  started_at timestamptz,
  ended_at timestamptz
);

-- ──────────────────────────────────────────────────────────────────────────
-- Updates (member-private)
-- ──────────────────────────────────────────────────────────────────────────
create table updates (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  ready boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, meeting_id)
);
create index updates_member_idx on updates(member_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Exploration format reference data (seeded from Hesse Partners guide)
-- ──────────────────────────────────────────────────────────────────────────
create table exploration_formats (
  code exploration_format_code primary key,
  category tool_category not null,
  display_name text not null,
  default_minutes int not null,
  short_description text not null,
  moderator_instructions text not null,
  source_attribution text not null default 'Hesse Partners — Forum Tools Moderator Guide 2025'
);

-- ──────────────────────────────────────────────────────────────────────────
-- Parking lot
-- ──────────────────────────────────────────────────────────────────────────
create table parking_lot_items (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  submitter_member_id uuid not null references members(id),
  added_by_member_id uuid not null references members(id),
  topic text not null,
  context text,
  urgency urgency not null default 'med',
  tool_category tool_category not null,
  exploration_format exploration_format_code not null,
  status parking_lot_status not null default 'parked',
  scheduled_meeting_id uuid references meetings(id) on delete set null,
  presented_at timestamptz,
  takeaways text,
  created_at timestamptz not null default now()
);
create index parking_lot_forum_status_idx on parking_lot_items(forum_id, status);

-- Add the FK from agenda_items to parking_lot_items now that the table exists.
alter table agenda_items
  add constraint agenda_items_parking_lot_fk
  foreign key (parking_lot_item_id) references parking_lot_items(id) on delete set null;

-- ──────────────────────────────────────────────────────────────────────────
-- Commitments (forum-visible)
-- ──────────────────────────────────────────────────────────────────────────
create table commitments (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  meeting_id uuid references meetings(id) on delete set null,
  text text not null,
  due_date date,
  status commitment_status not null default 'open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commitments_forum_idx on commitments(forum_id, status);

-- ──────────────────────────────────────────────────────────────────────────
-- Photo gallery
-- ──────────────────────────────────────────────────────────────────────────
create table photo_albums (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  name text not null,
  cover_photo_id uuid,
  created_by uuid references members(id),
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default uuid_generate_v4(),
  forum_id uuid not null references forums(id) on delete cascade,
  uploader_member_id uuid not null references members(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at date,
  uploaded_at timestamptz not null default now(),
  album_id uuid references photo_albums(id) on delete set null,
  tags text[] not null default '{}'::text[]
);
create index photos_forum_idx on photos(forum_id, uploaded_at desc);

alter table photo_albums
  add constraint photo_albums_cover_fk
  foreign key (cover_photo_id) references photos(id) on delete set null;

create table photo_reactions (
  photo_id uuid not null references photos(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, member_id, emoji)
);

create table photo_comments (
  id uuid primary key default uuid_generate_v4(),
  photo_id uuid not null references photos(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- AI interaction audit log (no content, just metadata)
-- ──────────────────────────────────────────────────────────────────────────
create table ai_interactions (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  prompt_hash text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);
create index ai_interactions_member_idx on ai_interactions(member_id, created_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ──────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger updates_updated_at before update on updates
  for each row execute function set_updated_at();

create trigger commitments_updated_at before update on commitments
  for each row execute function set_updated_at();
