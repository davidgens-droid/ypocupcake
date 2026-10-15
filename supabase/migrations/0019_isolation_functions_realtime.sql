-- Cupcake — multi-forum isolation, part 3 of 3: functions and side channels.
--
-- * Every SECURITY DEFINER function: fixed search_path, no PUBLIC/anon
--   execute, an auth.uid() guard.
-- * create_notification(): was callable by anyone for any member in any forum
--   with an arbitrary link. Now: caller must be an active member, recipient
--   must be in the caller's forum, kind is allow-listed, link must be a
--   relative app path, sizes are bounded.
-- * Realtime: REPLICA IDENTITY FULL made DELETE events broadcast the whole
--   old row to any subscriber (RLS is not applied to DELETE events). DEFAULT
--   identity sends only the primary key. UPDATE events still carry the new
--   row, which is all the app uses.
--
-- Idempotent. Spec §5.4, §5.6.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. create_notification
-- ──────────────────────────────────────────────────────────────────────────
-- The title is composed HERE from the caller's own name and the kind — a
-- caller can no longer put another member's name on a notification. The
-- signature therefore loses p_title; the old overload is dropped so it can't
-- linger alongside.
drop function if exists create_notification(uuid, text, text, text, text);

create or replace function create_notification(
  p_member_id uuid,
  p_kind text,
  p_detail text default null,
  p_link text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_forum uuid := current_member_forum();
  v_actor text;
  v_title text;
begin
  if auth.uid() is null or v_forum is null then
    raise exception 'not_authenticated';
  end if;
  select name into v_actor from members where id = auth.uid();
  v_title := case p_kind
    when 'topic_added_on_behalf' then v_actor || ' parked a topic for you'
    when 'photo_comment'         then v_actor || ' commented on your photo'
    else null
  end;
  if v_title is null then
    raise exception 'invalid_kind';
  end if;
  if not exists (
    select 1 from members
    where id = p_member_id and forum_id = v_forum and status = 'active'
  ) then
    raise exception 'recipient_not_in_forum';
  end if;
  -- A path inside this app only: must start with a single '/', and may not
  -- contain backslashes (URL parsers treat '\' as '/', so '/\evil.example'
  -- would resolve off-site), whitespace or control characters.
  if p_link is not null and (
    p_link !~ '^/([A-Za-z0-9_?#-]|$)'
    or p_link ~ '[\\[:space:][:cntrl:]]'
  ) then
    raise exception 'invalid_link';
  end if;
  if length(coalesce(p_detail, '')) > 2000 or length(coalesce(p_link, '')) > 500 then
    raise exception 'too_long';
  end if;

  insert into notifications (member_id, kind, title, detail, link)
  values (p_member_id, p_kind, left(v_title, 200), p_detail, p_link)
  returning id into v_id;
  return v_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. forum_qol_history: unchanged body; add the auth guard and privileges
-- ──────────────────────────────────────────────────────────────────────────
create or replace function forum_qol_history()
returns table (
  member_id uuid,
  member_name text,
  meeting_id uuid,
  scheduled_at timestamptz,
  physical int,
  mental int,
  financial int,
  friends int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or current_member_forum() is null then
    raise exception 'not_authenticated';
  end if;
  if not (
    has_role('moderator')
    or has_role('assistant_moderator')
    or has_role('technology')
  ) then
    raise exception 'Not authorized to view QOL history';
  end if;

  return query
  select
    u.member_id,
    m.name,
    mt.id,
    mt.scheduled_at,
    nullif(u.content -> 'qol' ->> 'physical_health', '')::int,
    nullif(u.content -> 'qol' ->> 'mental_health', '')::int,
    nullif(u.content -> 'qol' ->> 'financial_health', '')::int,
    nullif(u.content -> 'qol' ->> 'friends_community', '')::int
  from updates u
  join members m on m.id = u.member_id
  join meetings mt on mt.id = u.meeting_id
  where m.forum_id = current_member_forum()
    and mt.forum_id = current_member_forum()
    and u.completed_at is not null
    and u.content ? 'qol'
  order by mt.scheduled_at asc, m.name asc;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Execute privileges
-- ──────────────────────────────────────────────────────────────────────────
revoke execute on function has_role(role_type) from public, anon;
grant  execute on function has_role(role_type) to authenticated;
revoke execute on function forum_qol_history() from public, anon;
grant  execute on function forum_qol_history() to authenticated;
revoke execute on function create_notification(uuid, text, text, text) from public, anon;
grant  execute on function create_notification(uuid, text, text, text) to authenticated;
-- Trigger function: nobody calls it directly. EXECUTE is checked at CREATE
-- TRIGGER time (owner), not when the trigger fires.
revoke execute on function handle_new_user() from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Realtime: DELETE events carry only the primary key
-- ──────────────────────────────────────────────────────────────────────────
alter table meetings       replica identity default;
alter table meeting_rounds replica identity default;
alter table attendees      replica identity default;
alter table notifications  replica identity default;

-- attendees' primary key IS (meeting_id, member_id) — a cross-forum relation
-- even with default identity — and no client subscribes to it. Unpublish.
do $$ begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendees'
  ) then
    alter publication supabase_realtime drop table attendees;
  end if;
end $$;
