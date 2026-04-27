-- Cupcake — In-app notifications
-- Server actions insert via the SECURITY DEFINER `create_notification` function
-- so that an actor (e.g. czar) can create a notification for *another* member
-- (the submitter) without that bypassing RLS being implicit in app code.

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  title text not null,
  detail text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_member_unread_idx
  on notifications(member_id, created_at desc)
  where read_at is null;

create index notifications_member_recent_idx
  on notifications(member_id, created_at desc);

alter table notifications enable row level security;

-- Members can only see and mark-read their own notifications.
create policy notifications_self_only on notifications
  for all using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- Inserter helper that bypasses RLS (other members can't INSERT for someone
-- else under the self_only policy). Stays SECURITY DEFINER so any logged-in
-- caller can create a notification for any member.
create or replace function create_notification(
  p_member_id uuid,
  p_kind text,
  p_title text,
  p_detail text default null,
  p_link text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into notifications (member_id, kind, title, detail, link)
  values (p_member_id, p_kind, p_title, p_detail, p_link)
  returning id into v_id;
  return v_id;
end;
$$;

-- Allow Realtime broadcast on notifications so the header bell can update live.
alter publication supabase_realtime add table notifications;
alter table notifications replica identity full;
