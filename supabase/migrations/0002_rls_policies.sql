-- Cupcake — Row Level Security policies (V1)
-- Privacy posture:
--   • updates: member-private (no admin/moderator bypass)
--   • parking_lot, commitments, photos, agenda: forum-visible to members
--   • role-gated writes for czar (parking_lot mgmt) and moderator/asst (agenda)

-- ──────────────────────────────────────────────────────────────────────────
-- Enable RLS on every table
-- ──────────────────────────────────────────────────────────────────────────
alter table forums                enable row level security;
alter table members               enable row level security;
alter table roles                 enable row level security;
alter table meetings              enable row level security;
alter table attendees             enable row level security;
alter table agenda_items          enable row level security;
alter table meeting_rounds        enable row level security;
alter table updates               enable row level security;
alter table exploration_formats   enable row level security;
alter table parking_lot_items     enable row level security;
alter table commitments           enable row level security;
alter table photos                enable row level security;
alter table photo_albums          enable row level security;
alter table photo_reactions       enable row level security;
alter table photo_comments        enable row level security;
alter table ai_interactions       enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- forums: members can read their own forum
-- ──────────────────────────────────────────────────────────────────────────
create policy forums_member_read on forums
  for select using (id = current_member_forum());

-- ──────────────────────────────────────────────────────────────────────────
-- members: read own forum's roster; update self only
-- ──────────────────────────────────────────────────────────────────────────
create policy members_forum_read on members
  for select using (forum_id = current_member_forum());

create policy members_self_update on members
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- roles: forum-visible read; admin-only write (admin flag on members)
-- ──────────────────────────────────────────────────────────────────────────
create policy roles_forum_read on roles
  for select using (forum_id = current_member_forum());

create policy roles_admin_write on roles
  for all using (
    exists (
      select 1 from members
      where id = auth.uid() and is_admin = true and forum_id = roles.forum_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- meetings: forum-visible read; moderator/admin write
-- ──────────────────────────────────────────────────────────────────────────
create policy meetings_forum_read on meetings
  for select using (forum_id = current_member_forum());

create policy meetings_moderator_write on meetings
  for all using (
    forum_id = current_member_forum() and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members
        where id = auth.uid() and is_admin = true and forum_id = meetings.forum_id
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- attendees: forum-visible; member can update own attendance/ready flag
-- ──────────────────────────────────────────────────────────────────────────
create policy attendees_forum_read on attendees
  for select using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
  );

create policy attendees_self_write on attendees
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy attendees_moderator_write on attendees
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (has_role('moderator') or has_role('assistant_moderator'))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- agenda_items: forum-visible read; moderator/asst-moderator write
-- ──────────────────────────────────────────────────────────────────────────
create policy agenda_forum_read on agenda_items
  for select using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
  );

create policy agenda_moderator_write on agenda_items
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (has_role('moderator') or has_role('assistant_moderator'))
  )
  with check (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (has_role('moderator') or has_role('assistant_moderator'))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- meeting_rounds: forum-visible; moderator/asst-moderator write
-- ──────────────────────────────────────────────────────────────────────────
create policy meeting_rounds_forum_read on meeting_rounds
  for select using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
  );

create policy meeting_rounds_moderator_write on meeting_rounds
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (has_role('moderator') or has_role('assistant_moderator'))
  );

-- ──────────────────────────────────────────────────────────────────────────
-- updates: member-private (no role bypass — privacy posture per spec §5.1)
-- ──────────────────────────────────────────────────────────────────────────
create policy updates_self_only on updates
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- exploration_formats: world-readable to authenticated users
-- ──────────────────────────────────────────────────────────────────────────
create policy formats_authenticated_read on exploration_formats
  for select using (auth.uid() is not null);

-- ──────────────────────────────────────────────────────────────────────────
-- parking_lot_items: forum-visible read; submitter or czar write; czar can
-- insert with arbitrary submitter_member_id
-- ──────────────────────────────────────────────────────────────────────────
create policy parking_lot_forum_read on parking_lot_items
  for select using (forum_id = current_member_forum());

create policy parking_lot_self_insert on parking_lot_items
  for insert with check (
    forum_id = current_member_forum()
    and submitter_member_id = auth.uid()
    and added_by_member_id = auth.uid()
  );

create policy parking_lot_czar_insert on parking_lot_items
  for insert with check (
    forum_id = current_member_forum()
    and added_by_member_id = auth.uid()
    and has_role('czar')
  );

create policy parking_lot_self_edit on parking_lot_items
  for update using (
    submitter_member_id = auth.uid() and status = 'parked'
  );

create policy parking_lot_czar_manage on parking_lot_items
  for update using (
    forum_id = current_member_forum() and has_role('czar')
  );

create policy parking_lot_self_delete on parking_lot_items
  for delete using (
    submitter_member_id = auth.uid() and status = 'parked'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- commitments: forum-visible read; author write
-- ──────────────────────────────────────────────────────────────────────────
create policy commitments_forum_read on commitments
  for select using (forum_id = current_member_forum());

create policy commitments_author_write on commitments
  for insert with check (
    forum_id = current_member_forum() and member_id = auth.uid()
  );

create policy commitments_author_update on commitments
  for update using (member_id = auth.uid());

create policy commitments_author_delete on commitments
  for delete using (member_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- photo gallery: forum-visible read; uploader-only write (no admin override)
-- ──────────────────────────────────────────────────────────────────────────
create policy photos_forum_read on photos
  for select using (forum_id = current_member_forum());

create policy photos_uploader_write on photos
  for all using (uploader_member_id = auth.uid())
  with check (uploader_member_id = auth.uid() and forum_id = current_member_forum());

create policy photo_albums_forum_read on photo_albums
  for select using (forum_id = current_member_forum());

create policy photo_albums_creator_write on photo_albums
  for all using (created_by = auth.uid())
  with check (created_by = auth.uid() and forum_id = current_member_forum());

create policy photo_reactions_forum_read on photo_reactions
  for select using (
    photo_id in (select id from photos where forum_id = current_member_forum())
  );

create policy photo_reactions_self_write on photo_reactions
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy photo_comments_forum_read on photo_comments
  for select using (
    photo_id in (select id from photos where forum_id = current_member_forum())
  );

create policy photo_comments_author_write on photo_comments
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────────────
-- ai_interactions: member-private (audit log)
-- ──────────────────────────────────────────────────────────────────────────
create policy ai_interactions_self_only on ai_interactions
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());
