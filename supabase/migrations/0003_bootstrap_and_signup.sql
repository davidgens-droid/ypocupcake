-- Cupcake — bootstrap data + invite-based signup flow
--
-- A user can sign in via Supabase Auth (magic link) only if their email has
-- been invited. On first auth, a trigger creates the corresponding members
-- row using metadata from member_invites, then removes the invite.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Member invites (admin-managed)
-- ──────────────────────────────────────────────────────────────────────────
create table member_invites (
  email text primary key,
  forum_id uuid not null references forums(id) on delete cascade,
  name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table member_invites enable row level security;

-- Only admins can see/manage invites for their forum.
create policy invites_admin_read on member_invites
  for select using (
    exists (
      select 1 from members m
      where m.id = auth.uid() and m.is_admin = true and m.forum_id = member_invites.forum_id
    )
  );

create policy invites_admin_write on member_invites
  for all using (
    exists (
      select 1 from members m
      where m.id = auth.uid() and m.is_admin = true and m.forum_id = member_invites.forum_id
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Handle new auth user → create members row from invite
-- ──────────────────────────────────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite member_invites%rowtype;
begin
  select * into v_invite
  from member_invites
  where lower(email) = lower(new.email);

  if not found then
    -- No invite: leave them without a membership. The app proxy redirects
    -- such users to a "not invited" page.
    return new;
  end if;

  insert into members (id, forum_id, email, name, is_admin)
  values (new.id, v_invite.forum_id, new.email, v_invite.name, v_invite.is_admin);

  delete from member_invites where email = v_invite.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Bootstrap: create the Cupcake forum + David's admin invite
-- ──────────────────────────────────────────────────────────────────────────
insert into forums (name)
values ('Cupcake')
on conflict do nothing;

insert into member_invites (email, forum_id, name, is_admin)
select 'david.gens@merchantgrowth.com', f.id, 'David Gens', true
from forums f
where f.name = 'Cupcake'
on conflict (email) do update
set forum_id = excluded.forum_id,
    name = excluded.name,
    is_admin = excluded.is_admin;
