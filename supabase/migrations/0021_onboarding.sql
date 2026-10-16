-- Cupcake — multi-forum Phase 3: onboarding.
--
-- * platform_settings: one row, `signup_enabled`. The ONLY switch for public
--   forum creation; create_forum() refuses while it is false, and the app
--   hides the signup entry points. Flip it with:
--     update platform_settings set value = 'true' where key = 'signup_enabled';
-- * forum_invite_links + create_invite_link / revoke_invite_link (same-forum
--   admin), peek_invite (anyone holding the token learns the forum name and
--   whether the link still works — nothing else), join_forum (signed-in user
--   with no membership anywhere).
-- * create_forum: signed-in user with no membership anywhere becomes the
--   admin (+ moderator and technology roles for this year) of a new forum.
-- * Retires the email allowlist (member_invites + handle_new_user). Refuses
--   to run while invites are pending, so nobody is silently stranded.
--
-- Idempotent. Spec §4.1, §6, §11.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Platform settings
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table platform_settings enable row level security;
-- Readable by anyone (the login page needs to know whether to show "set up
-- a new forum"); never writable from a user session.
drop policy if exists platform_settings_public_read on platform_settings;
create policy platform_settings_public_read on platform_settings
  for select using (key in ('signup_enabled'));
revoke insert, update, delete on platform_settings from anon, authenticated;
insert into platform_settings (key, value) values ('signup_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function signup_enabled() returns boolean
language sql stable
set search_path = public
as $$
  select coalesce((select value = 'true'::jsonb from platform_settings where key = 'signup_enabled'), false)
$$;
grant execute on function signup_enabled() to anon, authenticated;

-- The same shape rule as update_forum_settings (0020): a zone Postgres knows
-- AND in the canonical Area/Location form (or UTC) that the app's renderer
-- accepts.
create or replace function is_valid_forum_timezone(p_timezone text) returns boolean
language sql stable
set search_path = public
as $$
  select p_timezone is not null
    and (p_timezone = 'UTC' or p_timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$')
    and p_timezone !~ '^(posix|right)/'
    and exists (select 1 from pg_timezone_names where name = p_timezone)
$$;
revoke execute on function is_valid_forum_timezone(text) from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Invite links
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists forum_invite_links (
  id uuid primary key default gen_random_uuid(),
  forum_id uuid not null references forums(id) on delete cascade,
  token text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  max_uses int check (max_uses is null or max_uses between 1 and 200),
  uses int not null default 0,
  revoked_at timestamptz
);
create index if not exists forum_invite_links_forum_idx on forum_invite_links(forum_id, created_at desc);
do $$ begin
  alter table forum_invite_links add constraint forum_invite_links_id_forum_unique unique (id, forum_id);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table forum_invite_links add constraint forum_invite_links_creator_fk
    foreign key (created_by, forum_id) references members(id, forum_id) on delete set null (created_by);
exception when duplicate_object then null; end $$;
-- Which link a member came in through (same forum by construction).
do $$ begin
  alter table members add constraint members_joined_via_link_fk
    foreign key (joined_via_link_id, forum_id) references forum_invite_links(id, forum_id)
    on delete set null (joined_via_link_id);
exception when duplicate_object then null; end $$;

alter table forum_invite_links enable row level security;
-- Admins of the forum may read their own links (token included, so the page
-- can show the URL). Nobody writes directly: the RPCs below are the only
-- write path, and anon never reads the table.
drop policy if exists invite_links_admin_read on forum_invite_links;
create policy invite_links_admin_read on forum_invite_links
  for select using (
    forum_id = current_member_forum()
    and exists (
      select 1 from members m
      where m.id = auth.uid() and m.is_admin = true and m.status = 'active'
    )
  );
revoke all on forum_invite_links from anon;
revoke insert, update, delete on forum_invite_links from authenticated;

create or replace function create_invite_link(p_expires_days int default 14, p_max_uses int default 25)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
  v_id uuid;
begin
  if p_expires_days is null or p_expires_days < 1 or p_expires_days > 90 then
    raise exception 'invalid_expiry';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 200) then
    raise exception 'invalid_max_uses';
  end if;
  perform lock_forum_admin_ops(v_forum);
  -- One live link per forum: issuing a new one retires the previous one.
  update forum_invite_links set revoked_at = now()
  where forum_id = v_forum and revoked_at is null;
  insert into forum_invite_links (forum_id, token, created_by, expires_at, max_uses)
  values (
    v_forum,
    -- 256 bits from the server's CSPRNG, as 64 hex characters.
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    auth.uid(),
    now() + make_interval(days => p_expires_days),
    p_max_uses
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function revoke_invite_link(p_link_id uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
begin
  update forum_invite_links
  set revoked_at = coalesce(revoked_at, now())
  where id = p_link_id and forum_id = v_forum;
  if not found then
    raise exception 'link_not_found';
  end if;
end;
$$;

-- What a link holder may learn before (or without) signing in: the forum's
-- name, whether the link still works, and — for a signed-in caller only —
-- whether the link points at the forum they already belong to (forum names
-- are not unique, so the page can't tell by name). Deliberately the one
-- SECURITY DEFINER function anon may call; it reads nothing else.
drop function if exists peek_invite(text);
create function peek_invite(p_token text)
returns table (forum_name text, valid boolean, reason text, is_mine boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_link forum_invite_links%rowtype;
  v_forum forums%rowtype;
  v_mine boolean := false;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    return query select null::text, false, 'unknown'::text, false; return;
  end if;
  select * into v_link from forum_invite_links l where l.token = p_token;
  if not found then
    return query select null::text, false, 'unknown'::text, false; return;
  end if;
  select * into v_forum from forums f where f.id = v_link.forum_id;
  if auth.uid() is not null then
    v_mine := exists (select 1 from members m where m.id = auth.uid() and m.forum_id = v_link.forum_id);
  end if;
  if v_forum.status <> 'active' then
    return query select v_forum.name, false, 'forum_suspended'::text, v_mine; return;
  end if;
  if v_link.revoked_at is not null then
    return query select v_forum.name, false, 'revoked'::text, v_mine; return;
  end if;
  if v_link.expires_at < now() then
    return query select v_forum.name, false, 'expired'::text, v_mine; return;
  end if;
  if v_link.max_uses is not null and v_link.uses >= v_link.max_uses then
    return query select v_forum.name, false, 'exhausted'::text, v_mine; return;
  end if;
  return query select v_forum.name, true, 'ok'::text, v_mine;
end;
$$;

create or replace function join_forum(p_token text, p_name text) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_link forum_invite_links%rowtype;
  v_forum forums%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  -- One forum per account, in any status: a removed member of A cannot
  -- join B with the same email.
  if exists (select 1 from members where id = v_uid) then
    raise exception 'already_member';
  end if;
  if p_name is null or length(trim(p_name)) < 1 or length(p_name) > 120 then
    raise exception 'invalid_name';
  end if;
  -- Lock the link so concurrent joins count correctly against max_uses.
  select * into v_link from forum_invite_links l where l.token = p_token for update;
  if not found then
    raise exception 'invalid_token';
  end if;
  select * into v_forum from forums f where f.id = v_link.forum_id;
  if v_forum.status <> 'active' then
    raise exception 'forum_suspended';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'revoked';
  end if;
  if v_link.expires_at < now() then
    raise exception 'expired';
  end if;
  if v_link.max_uses is not null and v_link.uses >= v_link.max_uses then
    raise exception 'exhausted';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'no_email';
  end if;

  insert into members (id, forum_id, email, name, is_admin, status, joined_via_link_id)
  values (v_uid, v_link.forum_id, v_email, trim(p_name), false, 'active', v_link.id);
  update forum_invite_links set uses = uses + 1 where id = v_link.id;
  return v_link.forum_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Create a forum
-- ──────────────────────────────────────────────────────────────────────────
create or replace function create_forum(p_name text, p_timezone text, p_admin_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_forum uuid;
  v_year int := extract(year from now())::int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not signup_enabled() then
    raise exception 'signup_disabled';
  end if;
  if exists (select 1 from members where id = v_uid) then
    raise exception 'already_member';
  end if;
  if p_name is null or length(trim(p_name)) < 2 or length(trim(p_name)) > 80 then
    raise exception 'invalid_name';
  end if;
  if p_admin_name is null or length(trim(p_admin_name)) < 1 or length(p_admin_name) > 120 then
    raise exception 'invalid_admin_name';
  end if;
  if not is_valid_forum_timezone(p_timezone) then
    raise exception 'invalid_timezone';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    raise exception 'no_email';
  end if;

  insert into forums (name, timezone, status, created_by)
  values (trim(p_name), p_timezone, 'active', v_uid)
  returning id into v_forum;
  insert into members (id, forum_id, email, name, is_admin, status)
  values (v_uid, v_forum, v_email, trim(p_admin_name), true, 'active');
  insert into roles (forum_id, member_id, role_type, year)
  values (v_forum, v_uid, 'moderator', v_year),
         (v_forum, v_uid, 'technology', v_year)
  on conflict do nothing;
  return v_forum;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Privileges
-- ──────────────────────────────────────────────────────────────────────────
revoke execute on function create_invite_link(int, int) from public, anon;
revoke execute on function revoke_invite_link(uuid) from public, anon;
revoke execute on function join_forum(text, text) from public, anon;
revoke execute on function create_forum(text, text, text) from public, anon;
revoke execute on function peek_invite(text) from public;
grant execute on function create_invite_link(int, int) to authenticated;
grant execute on function revoke_invite_link(uuid) to authenticated;
grant execute on function join_forum(text, text) to authenticated;
grant execute on function create_forum(text, text, text) to authenticated;
grant execute on function peek_invite(text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Retire the email allowlist
-- ──────────────────────────────────────────────────────────────────────────
-- Nested IFs on purpose: PL/pgSQL prepares each IF condition as one
-- statement, so a single `to_regclass(...) is not null and exists (select
-- 1 from member_invites)` fails to parse once the table is gone and the
-- migration could never be re-run. The inner statement is only prepared
-- when the table still exists.
do $$ begin
  if to_regclass('public.member_invites') is not null then
    if exists (select 1 from member_invites) then
      raise exception 'pending_invites_exist'
        using hint = 'Revoke the pending invites in Admin → Members (or let those people sign in first), then run this migration again.';
    end if;
  end if;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();
drop table if exists member_invites;

-- Record the founder of the original forum, for the platform page.
update forums f
set created_by = u.id
from auth.users u
where f.created_by is null
  and f.name = 'Cupcake'
  and lower(u.email) = 'david.gens@merchantgrowth.com';
