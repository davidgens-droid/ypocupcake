-- Cupcake — multi-forum Phase 2: the forum as a first-class object.
--
-- * forums.timezone / created_by (the existing forum keeps Vancouver).
-- * update_forum_settings(): the ONLY write path to a forum row from a user
--   session (name, timezone, charter). The column-level UPDATE grant from
--   0017 is withdrawn in favour of it.
-- * my_forum_status(): lets a removed member or a member of a suspended
--   forum be told why they can't get in (current_member_forum() is NULL for
--   them, so every ordinary read returns nothing).
-- * forum_ai_calls_today(): per-forum AI usage for the fair-use caps
--   (ai_interactions is member-private, so the forum total needs a definer).
--
-- Idempotent. Spec §7, §9.

alter table forums
  add column if not exists timezone text not null default 'America/Vancouver',
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Every forum update goes through the RPC below.
revoke update on forums from authenticated;

create or replace function update_forum_settings(
  p_name text default null,
  p_timezone text default null,
  p_charter text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
  v_settings jsonb;
begin
  if p_name is not null and (length(trim(p_name)) < 2 or length(p_name) > 80) then
    raise exception 'invalid_name';
  end if;
  -- Must be a zone Postgres knows AND one in the canonical Area/Location
  -- shape (or UTC) that the app's renderer (ICU via Intl) also accepts:
  -- pg_timezone_names includes names like 'Factory' or 'posix/...' that
  -- Intl rejects, and a stored unrenderable zone would break every
  -- meeting-time render for the forum.
  if p_timezone is not null and (
    (p_timezone <> 'UTC' and p_timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$')
    or p_timezone ~ '^(posix|right)/'
    or not exists (select 1 from pg_timezone_names where name = p_timezone)
  ) then
    raise exception 'invalid_timezone';
  end if;
  if p_charter is not null and length(p_charter) > 50000 then
    raise exception 'charter_too_long';
  end if;

  select settings into v_settings from forums where id = v_forum for update;
  if p_charter is not null then
    v_settings := coalesce(v_settings, '{}'::jsonb)
      || jsonb_build_object(
           'charter', p_charter,
           'charter_updated_at', now(),
           'charter_updated_by', auth.uid()
         );
  end if;

  update forums set
    name     = coalesce(nullif(trim(p_name), ''), name),
    timezone = coalesce(p_timezone, timezone),
    settings = coalesce(v_settings, settings)
  where id = v_forum;
end;
$$;

-- Why can't I get in? Returns the member's own status and their forum's,
-- plus the forum name — nothing else — regardless of current_member_forum().
create or replace function my_forum_status()
returns table (forum_name text, forum_status text, member_status text)
language sql stable security definer
set search_path = public
as $$
  select f.name, f.status, m.status
  from members m
  join forums f on f.id = m.forum_id
  where m.id = auth.uid()
$$;

-- AI calls made by everyone in the caller's forum in the last 24 hours.
create or replace function forum_ai_calls_today() returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int
  from ai_interactions a
  join members m on m.id = a.member_id
  where m.forum_id = current_member_forum()
    and a.created_at > now() - interval '24 hours'
$$;

revoke execute on function update_forum_settings(text, text, text) from public, anon;
revoke execute on function my_forum_status() from public, anon;
revoke execute on function forum_ai_calls_today() from public, anon;
grant execute on function update_forum_settings(text, text, text) to authenticated;
grant execute on function my_forum_status() to authenticated;
grant execute on function forum_ai_calls_today() to authenticated;
