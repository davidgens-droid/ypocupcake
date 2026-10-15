-- Cupcake — multi-forum isolation, part 1 of 3: the anchor.
--
-- Every policy in this database keys off current_member_forum(), i.e.
-- members.forum_id for auth.uid(). Until now a member could UPDATE their own
-- row without restriction — including forum_id (a one-request forum hop) and
-- is_admin. This migration makes the anchor immutable from any user session,
-- adds member/forum status so removal and suspension cut access everywhere
-- at once, and routes admin edits of other members through a SECURITY
-- DEFINER RPC that can never touch forum_id.
--
-- Idempotent. Spec: docs/superpowers/specs/2026-10-15-multi-forum-onboarding-design.md §5.1

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Status columns
-- ──────────────────────────────────────────────────────────────────────────
alter table forums
  add column if not exists status text not null default 'active';
do $$ begin
  alter table forums add constraint forums_status_check
    check (status in ('active', 'suspended'));
exception when duplicate_object then null; end $$;

alter table members
  add column if not exists status text not null default 'active',
  add column if not exists joined_via_link_id uuid; -- FK added with invite links (0021)
do $$ begin
  alter table members add constraint members_status_check
    check (status in ('active', 'removed'));
exception when duplicate_object then null; end $$;

-- Composite target for same-forum foreign keys (0018).
-- (ADD CONSTRAINT ... UNIQUE raises duplicate_table on re-run, not duplicate_object.)
do $$ begin
  alter table members add constraint members_id_forum_unique unique (id, forum_id);
exception when duplicate_object or duplicate_table then null; end $$;

-- forums: a user session may edit the charter (settings) and nothing else —
-- never status (which would suspend the forum) or name. Policies can't grant
-- beyond this, so an out-of-band forums UPDATE policy stays harmless.
revoke update on forums from authenticated;
grant update (settings) on forums to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. The anchor functions
-- ──────────────────────────────────────────────────────────────────────────
-- Active member of an active forum only: a removed member or a suspended
-- forum gets NULL, and every forum-scoped policy then matches nothing.
create or replace function current_member_forum() returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.forum_id
  from members m
  join forums f on f.id = m.forum_id
  where m.id = auth.uid()
    and m.status = 'active'
    and f.status = 'active'
$$;

-- The member's forum regardless of status — used ONLY to render the
-- "suspended" / "removed" pages. Never used in a policy.
create or replace function current_member_forum_any() returns uuid
language sql stable security definer
set search_path = public
as $$
  select forum_id from members where id = auth.uid()
$$;

-- Serialises admin mutations per forum so two admins acting at once can't
-- both pass a "last admin" check and leave the forum with none.
create or replace function lock_forum_admin_ops(p_forum uuid) returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('forum_admin:' || p_forum::text))
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Immutable identity columns
-- ──────────────────────────────────────────────────────────────────────────
-- Privilege level: a user session may update only profile fields. (Policies
-- can never grant beyond table privileges, so this holds even if a broader
-- policy exists out of band.)
revoke update on members from authenticated;
grant update (name, photo_url, family, birthday, anniversary)
  on members to authenticated;

-- Belt to the braces: even a privileged session can't move a member between
-- forums or flip flags unless the statement runs as the table owner — which
-- is exactly, and only, our SECURITY DEFINER RPCs (and the SQL editor).
create or replace function members_guard_identity()
returns trigger language plpgsql as $$
begin
  if (new.id is distinct from old.id)
     or (new.forum_id is distinct from old.forum_id)
     or (new.is_admin is distinct from old.is_admin)
     or (new.email is distinct from old.email)
     or (new.status is distinct from old.status)
     or (new.joined_via_link_id is distinct from old.joined_via_link_id)
  then
    if current_user <> 'postgres' then
      raise exception 'identity_locked'
        using hint = 'forum_id / is_admin / email / status change outside an owner function';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists members_guard_identity on members;
create trigger members_guard_identity
  before update on members
  for each row execute function members_guard_identity();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Admin RPCs (same-forum admin only; never forum_id / id / email)
-- ──────────────────────────────────────────────────────────────────────────
create or replace function assert_forum_admin() returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_forum uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select forum_id into v_forum
  from members
  where id = auth.uid() and is_admin = true and status = 'active';
  if v_forum is null or v_forum is distinct from current_member_forum() then
    raise exception 'not_admin';
  end if;
  return v_forum;
end;
$$;

create or replace function admin_update_member(p_member_id uuid, p_patch jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
  v_target members%rowtype;
  v_is_admin boolean;
begin
  perform lock_forum_admin_ops(v_forum);
  select * into v_target
  from members
  where id = p_member_id and forum_id = v_forum;
  if not found then
    raise exception 'member_not_in_forum';
  end if;

  -- family is rendered by the roster as { partner?: text, children?: text[] }:
  -- refuse any other shape rather than store something that breaks the page.
  if p_patch ? 'family' and p_patch -> 'family' is not null
     and jsonb_typeof(p_patch -> 'family') <> 'null' then
    if jsonb_typeof(p_patch -> 'family') <> 'object'
       or (p_patch -> 'family' ? 'partner' and jsonb_typeof(p_patch -> 'family' -> 'partner') not in ('string', 'null'))
       or (p_patch -> 'family' ? 'children' and jsonb_typeof(p_patch -> 'family' -> 'children') not in ('array', 'null'))
       or exists (
         select 1 from jsonb_array_elements(coalesce(p_patch -> 'family' -> 'children', '[]'::jsonb)) c
         where jsonb_typeof(c) <> 'string'
       )
    then
      raise exception 'invalid_family';
    end if;
  end if;

  v_is_admin := coalesce((p_patch ->> 'is_admin')::boolean, v_target.is_admin);
  if v_target.is_admin and not v_is_admin and v_target.status = 'active' then
    if not exists (
      select 1 from members
      where forum_id = v_forum and is_admin = true and status = 'active'
        and id <> p_member_id
    ) then
      raise exception 'last_admin';
    end if;
  end if;

  update members set
    name        = coalesce(nullif(trim(p_patch ->> 'name'), ''), name),
    photo_url   = case when p_patch ? 'photo_url'   then nullif(p_patch ->> 'photo_url', '')   else photo_url   end,
    family      = case when p_patch ? 'family'      then p_patch -> 'family'                    else family      end,
    birthday    = case when p_patch ? 'birthday'    then nullif(p_patch ->> 'birthday', '')::date    else birthday    end,
    anniversary = case when p_patch ? 'anniversary' then nullif(p_patch ->> 'anniversary', '')::date else anniversary end,
    is_admin    = v_is_admin
  where id = p_member_id and forum_id = v_forum;
end;
$$;

create or replace function remove_member(p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
  v_target members%rowtype;
begin
  perform lock_forum_admin_ops(v_forum);
  if p_member_id = auth.uid() then
    raise exception 'cannot_remove_self';
  end if;
  select * into v_target from members where id = p_member_id and forum_id = v_forum;
  if not found then
    raise exception 'member_not_in_forum';
  end if;
  if v_target.is_admin and v_target.status = 'active' and not exists (
    select 1 from members
    where forum_id = v_forum and is_admin = true and status = 'active' and id <> p_member_id
  ) then
    raise exception 'last_admin';
  end if;
  update members set status = 'removed' where id = p_member_id and forum_id = v_forum;
end;
$$;

create or replace function restore_member(p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
begin
  perform lock_forum_admin_ops(v_forum);
  update members set status = 'active'
  where id = p_member_id and forum_id = v_forum and status = 'removed';
  if not found then
    raise exception 'member_not_in_forum';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Execute privileges (hygiene for everything defined here)
-- ──────────────────────────────────────────────────────────────────────────
revoke execute on function current_member_forum() from public, anon;
revoke execute on function current_member_forum_any() from public, anon;
revoke execute on function lock_forum_admin_ops(uuid) from public, anon, authenticated;
revoke execute on function assert_forum_admin() from public, anon;
revoke execute on function admin_update_member(uuid, jsonb) from public, anon;
revoke execute on function remove_member(uuid) from public, anon;
revoke execute on function restore_member(uuid) from public, anon;
grant execute on function current_member_forum() to authenticated;
grant execute on function current_member_forum_any() to authenticated;
grant execute on function assert_forum_admin() to authenticated;
grant execute on function admin_update_member(uuid, jsonb) to authenticated;
grant execute on function remove_member(uuid) to authenticated;
grant execute on function restore_member(uuid) to authenticated;

-- Members read their forum's roster, removed members included (so names on
-- historical items — old parking-lot topics, photos, commitments — still
-- resolve, and admins can restore). Rosters and pickers filter on status in
-- the app. A removed member themselves reads nothing: current_member_forum()
-- is NULL for them. NEVER subquery members inside this policy (it recurses).
drop policy if exists members_forum_read on members;
create policy members_forum_read on members
  for select using (forum_id = current_member_forum());
