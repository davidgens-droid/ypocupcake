-- Cupcake — QOL History for forum leadership.
--
-- Member updates are otherwise strictly private (RLS: author-only, no admin
-- bypass). The ONE carve-out: the Quality-of-Life numbers are visible to the
-- moderator / assistant moderator / technology roles so they can track the
-- group's wellbeing over time.
--
-- This SECURITY DEFINER function returns ONLY the four QoL numbers (plus who
-- and which meeting) — never the feelings, situations, goals, or any other
-- update content. Access is gated to the three roles inside the function, so
-- no broad RLS grant on `updates` is needed (which would have leaked the rest).

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
    and u.completed_at is not null       -- only finalized updates (real history)
    and u.content ? 'qol'
  order by mt.scheduled_at asc, m.name asc;
end;
$$;

grant execute on function forum_qol_history() to authenticated;
