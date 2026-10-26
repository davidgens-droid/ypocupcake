-- Cupcake — multi-forum Phase 4: the platform operator layer.
--
-- * platform_admins: who may see the list of forums and pause one. Seeded
--   with the owner's account. Never readable from a user session; the two
--   SECURITY DEFINER functions below are the only way it is consulted.
-- * platform_forum_stats(): one row per forum with operator-level numbers
--   only (name, status, founder, counts, last activity). No member content,
--   and NO table gets a platform-wide SELECT policy.
-- * platform_set_forum_status(): suspend / reactivate a forum.
-- * platform_set_signup_enabled(): flip the public-signup switch from the
--   platform page instead of the SQL editor.
--
-- Idempotent. Spec §8.

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- No policies on purpose: nothing reads this table except the definers.
revoke all on platform_admins from anon, authenticated;

insert into platform_admins (user_id)
select u.id from auth.users u where lower(u.email) = 'david.gens@merchantgrowth.com'
on conflict (user_id) do nothing;

create or replace function is_platform_admin() returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from platform_admins p where p.user_id = auth.uid())
$$;

-- Dropped first: a later migration (0024) widens the return type, and
-- `create or replace` can't change a function's return type on a re-run.
drop function if exists platform_forum_stats();
create function platform_forum_stats()
returns table (
  forum_id uuid,
  name text,
  status text,
  timezone text,
  created_at timestamptz,
  founder_name text,
  founder_email text,
  member_count int,
  admin_count int,
  meeting_count int,
  next_meeting_at timestamptz,
  ai_calls_30d int,
  last_activity timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  return query
  select
    f.id,
    f.name,
    f.status,
    f.timezone,
    f.created_at,
    founder.name,
    founder.email,
    (select count(*)::int from members m where m.forum_id = f.id and m.status = 'active'),
    (select count(*)::int from members m where m.forum_id = f.id and m.status = 'active' and m.is_admin),
    (select count(*)::int from meetings mt where mt.forum_id = f.id and mt.status <> 'cancelled'),
    (select min(mt.scheduled_at) from meetings mt
      where mt.forum_id = f.id and mt.scheduled_at > now() and mt.status <> 'cancelled'),
    (select count(*)::int from ai_interactions a join members m on m.id = a.member_id
      where m.forum_id = f.id and a.created_at > now() - interval '30 days'),
    greatest(
      (select max(u.updated_at) from updates u join members m on m.id = u.member_id where m.forum_id = f.id),
      (select max(mt.scheduled_at) from meetings mt
        where mt.forum_id = f.id and mt.scheduled_at <= now() and mt.status <> 'cancelled'),
      (select max(a.created_at) from ai_interactions a join members m on m.id = a.member_id where m.forum_id = f.id),
      (select max(m.created_at) from members m where m.forum_id = f.id),
      f.created_at
    )
  from forums f
  -- The founder (created_by) or, if that account is gone, the
  -- longest-standing ACTIVE ADMIN — never an ordinary member.
  left join lateral (
    select m.name, m.email
    from members m
    where m.forum_id = f.id
      and (m.id = f.created_by or (m.is_admin and m.status = 'active'))
    order by (m.id = f.created_by) desc, m.created_at asc
    limit 1
  ) founder on true
  order by f.created_at asc;
end;
$$;

create or replace function platform_set_forum_status(p_forum_id uuid, p_status text) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_status';
  end if;
  -- Pausing your own forum would end your own access, platform page
  -- included; the UI hides the button, and this makes the API agree.
  if p_status = 'suspended' and exists (
    select 1 from members m
    where m.id = auth.uid() and m.forum_id = p_forum_id and m.status = 'active'
  ) then
    raise exception 'own_forum';
  end if;
  update forums set status = p_status where id = p_forum_id;
  if not found then
    raise exception 'forum_not_found';
  end if;
end;
$$;

create or replace function platform_set_signup_enabled(p_enabled boolean) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not_platform_admin';
  end if;
  insert into platform_settings (key, value, updated_at)
  values ('signup_enabled', to_jsonb(coalesce(p_enabled, false)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke execute on function is_platform_admin() from public, anon;
revoke execute on function platform_forum_stats() from public, anon;
revoke execute on function platform_set_forum_status(uuid, text) from public, anon;
revoke execute on function platform_set_signup_enabled(boolean) from public, anon;
grant execute on function is_platform_admin() to authenticated;
grant execute on function platform_forum_stats() to authenticated;
grant execute on function platform_set_forum_status(uuid, text) to authenticated;
grant execute on function platform_set_signup_enabled(boolean) to authenticated;
