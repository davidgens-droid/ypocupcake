-- Cupcake — multi-forum isolation, part 2 of 3: same-forum by construction.
--
-- Several write policies pinned only auth.uid(), so a row could be written
-- that pointed at another forum's meeting, member, photo or parking-lot item
-- (given a stolen UUID). Every forum-owned row now carries forum_id, every
-- cross-row reference is a composite (id, forum_id) foreign key, has_role()
-- is forum-scoped, and every self-write policy carries an explicit
-- WITH CHECK. Idempotent. Spec §4.2, §5.2, §5.3.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. forum_id on the three tables that only had it via a parent
-- ──────────────────────────────────────────────────────────────────────────
alter table meeting_rounds add column if not exists forum_id uuid references forums(id) on delete cascade;
alter table attendees      add column if not exists forum_id uuid references forums(id) on delete cascade;
alter table agenda_items   add column if not exists forum_id uuid references forums(id) on delete cascade;

update meeting_rounds r set forum_id = m.forum_id from meetings m where m.id = r.meeting_id and r.forum_id is null;
update attendees      a set forum_id = m.forum_id from meetings m where m.id = a.meeting_id and a.forum_id is null;
update agenda_items   i set forum_id = m.forum_id from meetings m where m.id = i.meeting_id and i.forum_id is null;

alter table meeting_rounds alter column forum_id set not null;
alter table attendees      alter column forum_id set not null;
alter table agenda_items   alter column forum_id set not null;

-- Always derived from the meeting; a client-supplied value is overwritten.
create or replace function sync_forum_from_meeting()
returns trigger language plpgsql as $$
begin
  select forum_id into new.forum_id from meetings where id = new.meeting_id;
  if new.forum_id is null then
    raise exception 'meeting_not_found';
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_rounds_sync_forum on meeting_rounds;
create trigger meeting_rounds_sync_forum before insert or update of meeting_id, forum_id on meeting_rounds
  for each row execute function sync_forum_from_meeting();
drop trigger if exists attendees_sync_forum on attendees;
create trigger attendees_sync_forum before insert or update of meeting_id, forum_id on attendees
  for each row execute function sync_forum_from_meeting();
drop trigger if exists agenda_items_sync_forum on agenda_items;
create trigger agenda_items_sync_forum before insert or update of meeting_id, forum_id on agenda_items
  for each row execute function sync_forum_from_meeting();

create index if not exists meeting_rounds_forum_idx on meeting_rounds(forum_id);
create index if not exists attendees_forum_idx on attendees(forum_id);
create index if not exists agenda_items_forum_idx on agenda_items(forum_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Composite uniqueness targets
-- ──────────────────────────────────────────────────────────────────────────
-- (ADD CONSTRAINT ... UNIQUE raises duplicate_table on re-run, not duplicate_object.)
do $$ begin alter table meetings          add constraint meetings_id_forum_unique          unique (id, forum_id); exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin alter table photos            add constraint photos_id_forum_unique            unique (id, forum_id); exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin alter table photo_albums      add constraint photo_albums_id_forum_unique      unique (id, forum_id); exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin alter table parking_lot_items add constraint parking_lot_items_id_forum_unique unique (id, forum_id); exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin alter table agenda_items      add constraint agenda_items_id_forum_unique      unique (id, forum_id); exception when duplicate_object or duplicate_table then null; end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Composite foreign keys (the existing single-column FKs stay; these add
--    "and in the same forum"). ON DELETE actions mirror the originals; where
--    the original was SET NULL, only the referencing id column is nulled.
-- ──────────────────────────────────────────────────────────────────────────
do $$ begin alter table roles add constraint roles_member_forum_fk
  foreign key (member_id, forum_id) references members(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin alter table meetings add constraint meetings_host_forum_fk
  foreign key (host_member_id, forum_id) references members(id, forum_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table attendees add constraint attendees_meeting_forum_fk
  foreign key (meeting_id, forum_id) references meetings(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table attendees add constraint attendees_member_forum_fk
  foreign key (member_id, forum_id) references members(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin alter table agenda_items add constraint agenda_items_meeting_forum_fk
  foreign key (meeting_id, forum_id) references meetings(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table agenda_items add constraint agenda_items_item_forum_fk
  foreign key (parking_lot_item_id, forum_id) references parking_lot_items(id, forum_id)
  on delete set null (parking_lot_item_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table meeting_rounds add constraint meeting_rounds_meeting_forum_fk
  foreign key (meeting_id, forum_id) references meetings(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table meeting_rounds add constraint meeting_rounds_agenda_forum_fk
  foreign key (agenda_item_id, forum_id) references agenda_items(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table meeting_rounds add constraint meeting_rounds_item_forum_fk
  foreign key (parking_lot_item_id, forum_id) references parking_lot_items(id, forum_id)
  on delete set null (parking_lot_item_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table parking_lot_items add constraint parking_lot_submitter_forum_fk
  foreign key (submitter_member_id, forum_id) references members(id, forum_id);
exception when duplicate_object then null; end $$;
do $$ begin alter table parking_lot_items add constraint parking_lot_added_by_forum_fk
  foreign key (added_by_member_id, forum_id) references members(id, forum_id);
exception when duplicate_object then null; end $$;
do $$ begin alter table parking_lot_items add constraint parking_lot_scheduled_forum_fk
  foreign key (scheduled_meeting_id, forum_id) references meetings(id, forum_id)
  on delete set null (scheduled_meeting_id);
exception when duplicate_object then null; end $$;
do $$ begin alter table parking_lot_items add constraint parking_lot_captured_forum_fk
  foreign key (captured_meeting_id, forum_id) references meetings(id, forum_id)
  on delete set null (captured_meeting_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table commitments add constraint commitments_member_forum_fk
  foreign key (member_id, forum_id) references members(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table commitments add constraint commitments_meeting_forum_fk
  foreign key (meeting_id, forum_id) references meetings(id, forum_id)
  on delete set null (meeting_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table photos add constraint photos_uploader_forum_fk
  foreign key (uploader_member_id, forum_id) references members(id, forum_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin alter table photos add constraint photos_album_forum_fk
  foreign key (album_id, forum_id) references photo_albums(id, forum_id)
  on delete set null (album_id);
exception when duplicate_object then null; end $$;

do $$ begin alter table photo_albums add constraint photo_albums_creator_forum_fk
  foreign key (created_by, forum_id) references members(id, forum_id);
exception when duplicate_object then null; end $$;
do $$ begin alter table photo_albums add constraint photo_albums_cover_forum_fk
  foreign key (cover_photo_id, forum_id) references photos(id, forum_id)
  on delete set null (cover_photo_id);
exception when duplicate_object then null; end $$;

-- Tables without forum_id of their own: assert the parent pair is same-forum.
create or replace function assert_update_same_forum()
returns trigger language plpgsql as $$
declare
  v_member_forum uuid;
  v_meeting_forum uuid;
begin
  select forum_id into v_member_forum from members where id = new.member_id;
  select forum_id into v_meeting_forum from meetings where id = new.meeting_id;
  if v_member_forum is null or v_meeting_forum is null or v_member_forum <> v_meeting_forum then
    raise exception 'cross_forum_reference';
  end if;
  return new;
end;
$$;
drop trigger if exists updates_same_forum on updates;
create trigger updates_same_forum before insert or update of member_id, meeting_id on updates
  for each row execute function assert_update_same_forum();

create or replace function assert_photo_ref_same_forum()
returns trigger language plpgsql as $$
declare
  v_member_forum uuid;
  v_photo_forum uuid;
begin
  select forum_id into v_member_forum from members where id = new.member_id;
  select forum_id into v_photo_forum from photos where id = new.photo_id;
  if v_member_forum is null or v_photo_forum is null or v_member_forum <> v_photo_forum then
    raise exception 'cross_forum_reference';
  end if;
  return new;
end;
$$;
drop trigger if exists photo_reactions_same_forum on photo_reactions;
create trigger photo_reactions_same_forum before insert or update of member_id, photo_id on photo_reactions
  for each row execute function assert_photo_ref_same_forum();
drop trigger if exists photo_comments_same_forum on photo_comments;
create trigger photo_comments_same_forum before insert or update of member_id, photo_id on photo_comments
  for each row execute function assert_photo_ref_same_forum();

-- The presenting order is an array of member ids: every one must belong to
-- the round's forum. Resolves the forum from the meeting itself (BEFORE
-- triggers fire alphabetically, so it must not depend on the sync trigger
-- having run first). On INSERT every id must be an ACTIVE member; on UPDATE
-- only ids that are new relative to OLD are checked, so a member removed
-- mid-round doesn't make every later reorder/advance fail.
create or replace function assert_round_order_in_forum()
returns trigger language plpgsql as $$
declare
  v_forum uuid;
  v_bad int;
  v_check uuid[];
begin
  select forum_id into v_forum from meetings where id = new.meeting_id;
  if v_forum is null then
    raise exception 'meeting_not_found';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(o.member_id), '{}') into v_check
    from unnest(new.order_member_ids) as o(member_id)
    where not (o.member_id = any (old.order_member_ids));
  else
    v_check := new.order_member_ids;
  end if;
  select count(*) into v_bad
  from unnest(v_check) as o(member_id)
  where not exists (
    select 1 from members m
    where m.id = o.member_id and m.forum_id = v_forum and m.status = 'active'
  );
  if v_bad > 0 then
    raise exception 'cross_forum_reference' using hint = 'order_member_ids';
  end if;
  return new;
end;
$$;
drop trigger if exists meeting_rounds_order_in_forum on meeting_rounds;
create trigger meeting_rounds_order_in_forum before insert or update of order_member_ids on meeting_rounds
  for each row execute function assert_round_order_in_forum();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. has_role(): the role must be in the caller's own (active) forum
-- ──────────────────────────────────────────────────────────────────────────
create or replace function has_role(p_role role_type) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from roles r
    where r.member_id = auth.uid()
      and r.role_type = p_role
      and r.year = extract(year from now())
      and r.forum_id = current_member_forum()
  )
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. WITH CHECK on every self-write policy
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists roles_admin_write on roles;
create policy roles_admin_write on roles
  for all using (
    forum_id = current_member_forum()
    and exists (
      select 1 from members
      where id = auth.uid() and is_admin = true and forum_id = roles.forum_id
    )
  )
  with check (
    forum_id = current_member_forum()
    and exists (
      select 1 from members
      where id = auth.uid() and is_admin = true and forum_id = roles.forum_id
    )
  );

drop policy if exists meetings_moderator_write on meetings;
create policy meetings_moderator_write on meetings
  for all using (
    forum_id = current_member_forum() and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members
        where id = auth.uid() and is_admin = true and forum_id = meetings.forum_id
      )
    )
  )
  with check (
    forum_id = current_member_forum() and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members
        where id = auth.uid() and is_admin = true and forum_id = meetings.forum_id
      )
    )
  );

drop policy if exists attendees_self_write on attendees;
create policy attendees_self_write on attendees
  for all using (member_id = auth.uid() and forum_id = current_member_forum())
  with check (member_id = auth.uid() and forum_id = current_member_forum());

-- A plain member may park an item of their own and later edit or withdraw
-- it; scheduling, capturing and presenting (the meeting-link columns) belong
-- to the privileged roles. Permissive policies are OR'd, so the self
-- policies must pin those columns explicitly.
drop policy if exists parking_lot_self_insert on parking_lot_items;
create policy parking_lot_self_insert on parking_lot_items
  for insert with check (
    forum_id = current_member_forum()
    and submitter_member_id = auth.uid()
    and added_by_member_id = auth.uid()
    and status = 'parked'
    and scheduled_meeting_id is null
    and captured_meeting_id is null
    and presented_at is null
    and takeaways is null
  );

drop policy if exists parking_lot_self_edit on parking_lot_items;
create policy parking_lot_self_edit on parking_lot_items
  for update using (
    submitter_member_id = auth.uid() and status = 'parked'
    and forum_id = current_member_forum()
  )
  with check (
    submitter_member_id = auth.uid() and forum_id = current_member_forum()
    and status in ('parked', 'withdrawn')
    and scheduled_meeting_id is null
    and captured_meeting_id is null
    and presented_at is null
    and takeaways is null
  );

drop policy if exists parking_lot_self_delete on parking_lot_items;
create policy parking_lot_self_delete on parking_lot_items
  for delete using (
    submitter_member_id = auth.uid() and status = 'parked'
    and forum_id = current_member_forum()
  );

drop policy if exists parking_lot_privileged_insert on parking_lot_items;
create policy parking_lot_privileged_insert on parking_lot_items
  for insert with check (
    forum_id = current_member_forum()
    and added_by_member_id = auth.uid()
    and submitter_member_id in (
      select id from members where forum_id = current_member_forum() and status = 'active'
    )
    and (
      has_role('czar')
      or has_role('moderator')
      or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid()
          and m.is_admin = true
          and m.forum_id = parking_lot_items.forum_id
      )
    )
  );

drop policy if exists parking_lot_privileged_manage on parking_lot_items;
create policy parking_lot_privileged_manage on parking_lot_items
  for update using (
    forum_id = current_member_forum()
    and (
      has_role('czar')
      or has_role('moderator')
      or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid()
          and m.is_admin = true
          and m.forum_id = parking_lot_items.forum_id
      )
    )
  )
  -- Permissive WITH CHECKs are OR'd across policies, so this one must repeat
  -- the privilege test or it would let any member pass their own edits
  -- through the privileged policy.
  with check (
    forum_id = current_member_forum()
    and (
      has_role('czar')
      or has_role('moderator')
      or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid()
          and m.is_admin = true
          and m.forum_id = parking_lot_items.forum_id
      )
    )
  );

drop policy if exists commitments_author_update on commitments;
create policy commitments_author_update on commitments
  for update using (member_id = auth.uid() and forum_id = current_member_forum())
  with check (member_id = auth.uid() and forum_id = current_member_forum());

drop policy if exists commitments_author_delete on commitments;
create policy commitments_author_delete on commitments
  for delete using (member_id = auth.uid() and forum_id = current_member_forum());

drop policy if exists photo_reactions_self_write on photo_reactions;
create policy photo_reactions_self_write on photo_reactions
  for all using (member_id = auth.uid())
  with check (
    member_id = auth.uid()
    and photo_id in (select id from photos where forum_id = current_member_forum())
  );

drop policy if exists photo_comments_author_write on photo_comments;
create policy photo_comments_author_write on photo_comments
  for all using (member_id = auth.uid())
  with check (
    member_id = auth.uid()
    and photo_id in (select id from photos where forum_id = current_member_forum())
  );

-- Reads of the three tables that now carry forum_id can use it directly.
drop policy if exists attendees_forum_read on attendees;
create policy attendees_forum_read on attendees
  for select using (forum_id = current_member_forum());
drop policy if exists agenda_forum_read on agenda_items;
create policy agenda_forum_read on agenda_items
  for select using (forum_id = current_member_forum());
drop policy if exists meeting_rounds_forum_read on meeting_rounds;
create policy meeting_rounds_forum_read on meeting_rounds
  for select using (forum_id = current_member_forum());
