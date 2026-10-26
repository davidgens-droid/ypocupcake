-- Cupcake — "new photos" notifications for the whole forum
--
-- * create_notification(): two more kinds, 'photo_added' (one photo) and
--   'photos_added' (a batch). Body otherwise identical to 0019.
-- * notify_forum_members(): one call fans a notification out to every
--   OTHER active member of the caller's forum, through create_notification
--   per recipient, so the same validation (caller's own name in the title,
--   relative link only, bounded sizes) applies. Only the forum-wide kinds
--   are allowed here: a member can't blast "X commented on your photo" to
--   everyone. Returns how many members were notified.
--
-- Idempotent; re-runnable after 0019 (which it supersedes for this function).

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
    when 'photo_added'           then v_actor || ' added a photo'
    when 'photos_added'          then v_actor || ' added photos'
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

revoke execute on function create_notification(uuid, text, text, text) from public, anon;
grant  execute on function create_notification(uuid, text, text, text) to authenticated;

create or replace function notify_forum_members(
  p_kind text,
  p_detail text default null,
  p_link text default null
) returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_forum uuid := current_member_forum();
  v_count int := 0;
  r record;
begin
  if auth.uid() is null or v_forum is null then
    raise exception 'not_authenticated';
  end if;
  if p_kind not in ('photo_added', 'photos_added') then
    raise exception 'invalid_kind';
  end if;
  for r in
    select id from members
    where forum_id = v_forum and status = 'active' and id <> auth.uid()
  loop
    perform create_notification(r.id, p_kind, p_detail, p_link);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function notify_forum_members(text, text, text) from public, anon;
grant  execute on function notify_forum_members(text, text, text) to authenticated;
