-- Cupcake — end-to-end encrypted member updates.
--
-- Spec: docs/superpowers/specs/2026-10-25-e2e-encrypted-updates-design.md
--
-- * member_key_wraps: locked copies of each member's update key (one row per
--   passkey / passphrase / recovery code). Owner-only. The server never sees
--   an unwrapped key.
-- * updates: encrypted envelope in content_enc; the four QoL scores in their
--   own columns (the one legitimately shared part); plaintext `content` is
--   blanked per row as each member's device migrates it, and a row may never
--   hold both.
-- * ai_pattern_cards: encrypted payload; existing cards are deleted (they
--   were derived from plaintext updates and regenerate on the device).
-- * forum_qol_history() reads the columns. setup_member_keys() and
--   reset_member_encrypted_data() are the two atomic operations.
-- * platform_forum_stats() gains protected_count.
--
-- Idempotent and re-runnable.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Key wraps
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists member_key_wraps (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null check (kind in ('passkey', 'passphrase', 'recovery')),
  -- passkey only
  credential_id text,
  public_key text,
  transports text[],
  prf_salt text,
  -- passphrase (PBKDF2) / recovery (HKDF) salts; base64url
  kdf_salt text,
  kdf_iterations int,
  -- AES-KW wrapped update key, base64url
  wrapped_key text not null,
  label text,
  -- Identity of the update key these wraps lock: one per setup, shared by
  -- every wrap of that setup. A device compares its cached key's id with
  -- this before trusting it, and every save carries it, so a key retired
  -- by "Start fresh" can never be used again from a stale device.
  key_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table member_key_wraps add column if not exists key_id uuid not null default gen_random_uuid();
-- Re-run over an earlier copy of this migration (no key_id yet): the column
-- default gave every existing wrap its own random id; give each member's
-- wraps ONE shared id again, as a fresh setup would.
update member_key_wraps w
set key_id = k.key_id
from (select member_id, min(key_id::text)::uuid as key_id from member_key_wraps group by member_id) k
where w.member_id = k.member_id and w.key_id <> k.key_id;
create index if not exists member_key_wraps_member_idx on member_key_wraps(member_id);
create unique index if not exists member_key_wraps_credential_unique
  on member_key_wraps(credential_id) where credential_id is not null;
create unique index if not exists member_key_wraps_one_passphrase
  on member_key_wraps(member_id) where kind = 'passphrase';
create unique index if not exists member_key_wraps_one_recovery
  on member_key_wraps(member_id) where kind = 'recovery';

alter table member_key_wraps enable row level security;
drop policy if exists member_key_wraps_self_only on member_key_wraps;
create policy member_key_wraps_self_only on member_key_wraps
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());
revoke all on member_key_wraps from anon;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. updates: envelope + QoL columns
-- ──────────────────────────────────────────────────────────────────────────
alter table updates
  add column if not exists content_enc text,
  add column if not exists qol_physical int,
  add column if not exists qol_mental int,
  add column if not exists qol_financial int,
  add column if not exists qol_friends int,
  add column if not exists key_version int not null default 1;
alter table updates alter column content drop not null;
alter table updates alter column content drop default;
do $$ begin
  alter table updates add constraint updates_qol_range check (
    (qol_physical  is null or qol_physical  between 1 and 10) and
    (qol_mental    is null or qol_mental    between 1 and 10) and
    (qol_financial is null or qol_financial between 1 and 10) and
    (qol_friends   is null or qol_friends   between 1 and 10)
  );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table updates add constraint updates_plain_xor_enc
    check (content is null or content_enc is null);
exception when duplicate_object then null; end $$;

-- One-off backfill of the scores from the (still readable) legacy rows.
update updates
set qol_physical  = coalesce(qol_physical,  nullif(content -> 'qol' ->> 'physical_health', '')::int),
    qol_mental    = coalesce(qol_mental,    nullif(content -> 'qol' ->> 'mental_health', '')::int),
    qol_financial = coalesce(qol_financial, nullif(content -> 'qol' ->> 'financial_health', '')::int),
    qol_friends   = coalesce(qol_friends,   nullif(content -> 'qol' ->> 'friends_community', '')::int)
where content is not null
  and content ? 'qol'
  and (qol_physical is null or qol_mental is null or qol_financial is null or qol_friends is null);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. ai_pattern_cards: encrypted payload
-- ──────────────────────────────────────────────────────────────────────────
alter table ai_pattern_cards
  add column if not exists payload_enc text;
alter table ai_pattern_cards alter column title drop not null;
alter table ai_pattern_cards alter column detail drop not null;
do $$ begin
  alter table ai_pattern_cards add constraint cards_plain_xor_enc
    check (title is null or payload_enc is null);
exception when duplicate_object then null; end $$;
-- Derived from plaintext updates: as sensitive as the updates themselves.
delete from ai_pattern_cards where payload_enc is null;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. forum_qol_history(): the scores now live in columns
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
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
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
    u.qol_physical,
    u.qol_mental,
    u.qol_financial,
    u.qol_friends
  from updates u
  join members m on m.id = u.member_id
  join meetings mt on mt.id = u.meeting_id
  where mt.forum_id = current_member_forum()
    and m.forum_id = current_member_forum()
    and u.completed_at is not null
    and u.qol_physical is not null
  order by mt.scheduled_at asc, m.name asc;
end;
$$;
revoke execute on function forum_qol_history() from public, anon;
grant execute on function forum_qol_history() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Setup and reset
-- ──────────────────────────────────────────────────────────────────────────
-- p_wraps: json array of {kind, credential_id?, public_key?, transports?,
-- prf_salt?, kdf_salt?, kdf_iterations?, wrapped_key, label?}. Requires at
-- least one unlock method (passkey or passphrase) and exactly one recovery
-- wrap, inserted atomically; refuses if the member already has keys.
-- Returns the new key id shared by all the wraps.
drop function if exists setup_member_keys(jsonb);
create function setup_member_keys(p_wraps jsonb) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key uuid := gen_random_uuid();
  v_wrap jsonb;
  v_kind text;
  v_methods int := 0;
  v_recovery int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from members m where m.id = v_uid and m.status = 'active') then
    raise exception 'not_member';
  end if;
  if exists (select 1 from member_key_wraps w where w.member_id = v_uid) then
    raise exception 'already_set_up';
  end if;
  if p_wraps is null or jsonb_typeof(p_wraps) <> 'array' or jsonb_array_length(p_wraps) < 2 or jsonb_array_length(p_wraps) > 4 then
    raise exception 'invalid_wraps';
  end if;

  for v_wrap in select * from jsonb_array_elements(p_wraps) loop
    v_kind := v_wrap ->> 'kind';
    if v_kind not in ('passkey', 'passphrase', 'recovery') then
      raise exception 'invalid_wraps';
    end if;
    if coalesce(length(v_wrap ->> 'wrapped_key'), 0) not between 40 and 200 then
      raise exception 'invalid_wraps';
    end if;
    if v_kind = 'passkey' and (coalesce(length(v_wrap ->> 'credential_id'), 0) < 8 or coalesce(length(v_wrap ->> 'prf_salt'), 0) < 16) then
      raise exception 'invalid_wraps';
    end if;
    if v_kind in ('passphrase', 'recovery') and coalesce(length(v_wrap ->> 'kdf_salt'), 0) < 16 then
      raise exception 'invalid_wraps';
    end if;
    if v_kind = 'passphrase' and coalesce((v_wrap ->> 'kdf_iterations')::int, 0) < 100000 then
      raise exception 'invalid_wraps';
    end if;
    if v_kind = 'recovery' then v_recovery := v_recovery + 1; else v_methods := v_methods + 1; end if;

    insert into member_key_wraps (member_id, kind, credential_id, public_key, transports, prf_salt, kdf_salt, kdf_iterations, wrapped_key, label, key_id)
    values (
      v_uid,
      v_kind,
      v_wrap ->> 'credential_id',
      v_wrap ->> 'public_key',
      case when v_wrap ? 'transports' and jsonb_typeof(v_wrap -> 'transports') = 'array'
           then array(select jsonb_array_elements_text(v_wrap -> 'transports')) else null end,
      v_wrap ->> 'prf_salt',
      v_wrap ->> 'kdf_salt',
      (v_wrap ->> 'kdf_iterations')::int,
      v_wrap ->> 'wrapped_key',
      left(v_wrap ->> 'label', 80),
      v_key
    );
  end loop;

  if v_methods < 1 or v_recovery <> 1 then
    raise exception 'invalid_wraps';
  end if;
  return v_key;
end;
$$;

-- Set or change the passphrase / recovery code: at most one of each, so the
-- old copy is replaced in the same transaction (on failure the old one keeps
-- working).
create or replace function replace_member_key_wrap(p_wrap jsonb) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := p_wrap ->> 'kind';
  v_key uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_kind not in ('passphrase', 'recovery') then
    raise exception 'invalid_wraps';
  end if;
  if coalesce(length(p_wrap ->> 'wrapped_key'), 0) not between 40 and 200
     or coalesce(length(p_wrap ->> 'kdf_salt'), 0) < 16
     or (v_kind = 'passphrase' and coalesce((p_wrap ->> 'kdf_iterations')::int, 0) < 100000) then
    raise exception 'invalid_wraps';
  end if;
  select w.key_id into v_key from member_key_wraps w where w.member_id = v_uid limit 1;
  if v_key is null then
    raise exception 'not_set_up';
  end if;
  delete from member_key_wraps where member_id = v_uid and kind = v_kind;
  insert into member_key_wraps (member_id, kind, kdf_salt, kdf_iterations, wrapped_key, key_id)
  values (v_uid, v_kind, p_wrap ->> 'kdf_salt', (p_wrap ->> 'kdf_iterations')::int, p_wrap ->> 'wrapped_key', v_key);
end;
$$;
revoke execute on function replace_member_key_wrap(jsonb) from public, anon;
grant execute on function replace_member_key_wrap(jsonb) to authenticated;

-- "Start fresh": the content of the caller's updates (encrypted and legacy
-- alike), their pattern cards and their key wraps go, in one transaction.
-- The update ROWS stay, keeping the four QoL scores and the finalized
-- dates that the forum's QOL History legitimately shows; the "Ready" mirror
-- for upcoming meetings is withdrawn because there is no update behind it.
create or replace function reset_member_encrypted_data() returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  update updates set content = null, content_enc = null, ready = false
  where member_id = v_uid;
  update attendees set ready = false, ready_at = null
  where member_id = v_uid
    and meeting_id in (select id from meetings where scheduled_at > now());
  delete from ai_pattern_cards where member_id = v_uid;
  delete from member_key_wraps where member_id = v_uid;
end;
$$;

revoke execute on function setup_member_keys(jsonb) from public, anon;
revoke execute on function reset_member_encrypted_data() from public, anon;
grant execute on function setup_member_keys(jsonb) to authenticated;
grant execute on function reset_member_encrypted_data() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. platform_forum_stats(): how many active members have set up protection
-- ──────────────────────────────────────────────────────────────────────────
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
  protected_count int,
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
    (select count(*)::int from members m where m.forum_id = f.id and m.status = 'active'
       and exists (select 1 from member_key_wraps w where w.member_id = m.id)),
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
revoke execute on function platform_forum_stats() from public, anon;
grant execute on function platform_forum_stats() to authenticated;
