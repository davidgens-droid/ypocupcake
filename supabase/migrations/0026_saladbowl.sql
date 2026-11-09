-- Salad Bowl — a party game served from the same site at /saladbowl.
--
-- It is NOT part of Cupcake: no forum, member or auth table is read or
-- written here, and nothing in Cupcake reads these tables.
--
-- Shape
-- * Four private tables (saladbowl_games / _players / _words / _plays) with
--   RLS on and NO policies: nobody reads or writes them directly.
-- * One tiny public table, saladbowl_pulse (game id + version number), that
--   phones subscribe to over Realtime so they know when to refresh.
-- * Players have no accounts. Joining a game mints a random seat token that
--   lives on the phone; every call presents the game code + that token.
-- * All access goes through the SECURITY DEFINER functions at the bottom
--   (saladbowl_create / _join / _state / _add_word / _remove_word / _host /
--   _turn), which are executable by anon on purpose. Each validates its own
--   input, bounds every size, and only ever touches saladbowl_* tables.
--   Helpers named saladbowl__* (two underscores) are internal: not definer,
--   not executable by anon.
-- * Words still in the bowl are never returned to anyone but the player
--   whose turn it is.
-- * Games clean themselves up: creating a game deletes any game untouched
--   for 48 hours, and any game at all after 7 days.
-- * A game is always three rounds (describe, charades, one word); the host
--   chooses the order.
--
-- Idempotent; safe to re-run.

-- ─── tables ──────────────────────────────────────────────────────────────────

create table if not exists saladbowl_games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  settings jsonb not null,
  version bigint not null default 1,
  round_index int not null default 0,
  turn_no int not null default 0,
  turn_state text not null default 'ready'
    check (turn_state in ('ready', 'active', 'paused', 'review', 'round_end')),
  current_team int,
  current_player uuid,
  team_cursor int[] not null default array[0, 0, 0, 0],
  score_adjust int[] not null default array[0, 0, 0, 0],
  current_word uuid,
  word_shown_at timestamptz,
  turn_ends_at timestamptz,
  turn_remaining_ms int,
  turn_skipped uuid[] not null default '{}',
  turn_skips int not null default 0,
  turn_words uuid[] not null default '{}',
  buzzer_word uuid,
  undo_word uuid,
  turn_end_reason text,
  leftover_ms int,
  state_since timestamptz not null default now(),
  creator_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists saladbowl_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references saladbowl_games (id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  name text not null,
  team int,
  seat int not null,
  is_host boolean not null default false,
  removed boolean not null default false,
  token_issued_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists saladbowl_players_game_idx on saladbowl_players (game_id);
create unique index if not exists saladbowl_players_name_idx
  on saladbowl_players (game_id, lower(name)) where not removed;

create table if not exists saladbowl_words (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references saladbowl_games (id) on delete cascade,
  player_id uuid not null references saladbowl_players (id) on delete cascade,
  text text not null,
  norm text not null,
  created_at timestamptz not null default now(),
  unique (game_id, norm)
);
create index if not exists saladbowl_words_player_idx on saladbowl_words (player_id);

create table if not exists saladbowl_plays (
  id bigint generated always as identity primary key,
  game_id uuid not null references saladbowl_games (id) on delete cascade,
  round_index int not null,
  turn_no int not null,
  word_id uuid not null references saladbowl_words (id) on delete cascade,
  player_id uuid not null,
  team int not null,
  kind text not null check (kind in ('got', 'skip')),
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists saladbowl_plays_game_idx on saladbowl_plays (game_id, round_index);
-- A word can be won only once per round.
create unique index if not exists saladbowl_plays_got_idx
  on saladbowl_plays (game_id, round_index, word_id) where kind = 'got';

create table if not exists saladbowl_pulse (
  game_id uuid primary key references saladbowl_games (id) on delete cascade,
  v bigint not null default 1
);

-- Columns added after the tables were first created (no-ops on a fresh install).
alter table saladbowl_games add column if not exists undo_word uuid;
alter table saladbowl_players add column if not exists token_issued_at timestamptz not null default now();

alter table saladbowl_games enable row level security;
alter table saladbowl_players enable row level security;
alter table saladbowl_words enable row level security;
alter table saladbowl_plays enable row level security;
alter table saladbowl_pulse enable row level security;

revoke all on table saladbowl_games, saladbowl_players, saladbowl_words, saladbowl_plays, saladbowl_pulse
  from public, anon, authenticated;
grant select on table saladbowl_pulse to anon, authenticated;

drop policy if exists saladbowl_pulse_read on saladbowl_pulse;
create policy saladbowl_pulse_read on saladbowl_pulse
  for select to anon, authenticated using (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'saladbowl_pulse'
     ) then
    alter publication supabase_realtime add table saladbowl_pulse;
  end if;
end $$;

-- ─── functions: start clean so a re-run never leaves an old signature ────────

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'saladbowl\_%'
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;

-- ─── internal helpers (saladbowl__*) ─────────────────────────────────────────

-- Collapse whitespace / control characters and cap the length.
create function saladbowl__clean(p text, p_max int) returns text
language sql immutable set search_path = public
as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max)
$$;

-- Comparison form of a word: lower-case, no punctuation, single spaces.
create function saladbowl__norm(p text) returns text
language sql immutable set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- Validate + normalise host settings. p is merged over p_old (shallow).
create function saladbowl__settings(p jsonb, p_old jsonb) returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  v jsonb := coalesce(p_old, '{}'::jsonb) || (case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end);
  v_letter text;
  v_words int := 4;
  v_secs int := 60;
  v_skip text;
  v_carry boolean := true;
  v_no_proper boolean := false;
  v_teams jsonb := '[]'::jsonb;
  v_rounds jsonb := '[]'::jsonb;
  v_defaults text[] := array['Lettuce Zeppelin', 'The Beet-les', 'Radishhead', 'Kale Halen'];
  v_n int := 2;
  v_name text;
  r text;
  i int;
begin
  v_letter := upper(left(btrim(coalesce(v->>'letter', '')), 1));
  if v_letter !~ '^[A-Z]$' then v_letter := ''; end if;

  if jsonb_typeof(v->'wordsPerPlayer') = 'number' then
    v_words := least(greatest((v->>'wordsPerPlayer')::numeric, 1), 10)::int;
  end if;
  if jsonb_typeof(v->'turnSeconds') = 'number' then
    v_secs := least(greatest((v->>'turnSeconds')::numeric, 15), 180)::int;
  end if;

  v_skip := coalesce(v->>'skipRule', 'one');
  if v_skip not in ('none', 'one', 'unlimited') then v_skip := 'one'; end if;
  if jsonb_typeof(v->'carryOver') = 'boolean' then v_carry := (v->>'carryOver')::boolean; end if;
  -- House rule shown to everyone while they write (and obeyed by the idea
  -- helper): no names of people, places, brands or titles. Not machine-checked.
  if jsonb_typeof(v->'noProperNouns') = 'boolean' then v_no_proper := (v->>'noProperNouns')::boolean; end if;

  if jsonb_typeof(v->'teams') = 'array' then
    v_n := least(greatest(jsonb_array_length(v->'teams'), 2), 4);
  end if;
  for i in 0 .. v_n - 1 loop
    v_name := '';
    if jsonb_typeof(v->'teams') = 'array' and jsonb_typeof(v->'teams'->i) = 'object' then
      v_name := saladbowl__clean(v->'teams'->i->>'name', 24);
    end if;
    if v_name = '' then v_name := v_defaults[i + 1]; end if;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('name', v_name));
  end loop;

  if jsonb_typeof(v->'rounds') = 'array' then
    for r in
      select t.value from jsonb_array_elements_text(v->'rounds') with ordinality as t(value, ord) order by t.ord
    loop
      if r in ('describe', 'charades', 'oneword') and not (v_rounds ? r) then
        v_rounds := v_rounds || to_jsonb(r);
      end if;
    end loop;
  end if;
  -- Always exactly three rounds: the host chooses their order, nothing else.
  foreach r in array array['describe', 'charades', 'oneword'] loop
    if not (v_rounds ? r) then v_rounds := v_rounds || to_jsonb(r); end if;
  end loop;

  return jsonb_build_object(
    'theme', saladbowl__clean(v->>'theme', 80),
    'letter', v_letter,
    'wordsPerPlayer', v_words,
    'turnSeconds', v_secs,
    'skipRule', v_skip,
    'carryOver', v_carry,
    'noProperNouns', v_no_proper,
    'teams', v_teams,
    'rounds', v_rounds
  );
end $$;

-- Every change bumps the version and pings subscribed phones.
create function saladbowl__bump(p_game uuid) returns void
language plpgsql set search_path = public
as $$
declare v bigint;
begin
  update saladbowl_games set version = version + 1, updated_at = now() where id = p_game returning version into v;
  insert into saladbowl_pulse (game_id, v) values (p_game, v)
    on conflict (game_id) do update set v = excluded.v;
end $$;

-- A random word still in the bowl this round (not yet won), avoiding p_exclude.
create function saladbowl__draw(p_game uuid, p_round int, p_exclude uuid[]) returns uuid
language sql set search_path = public
as $$
  select w.id
  from saladbowl_words w
  where w.game_id = p_game
    and not (w.id = any (coalesce(p_exclude, '{}'::uuid[])))
    and not exists (
      select 1 from saladbowl_plays p
      where p.game_id = p_game and p.round_index = p_round and p.kind = 'got' and p.word_id = w.id
    )
  order by random()
  limit 1
$$;

create function saladbowl__left(p_game uuid, p_round int) returns int
language sql set search_path = public
as $$
  select count(*)::int
  from saladbowl_words w
  where w.game_id = p_game
    and not exists (
      select 1 from saladbowl_plays p
      where p.game_id = p_game and p.round_index = p_round and p.kind = 'got' and p.word_id = w.id
    )
$$;

-- Who would be up if the turn passed to p_from_team (or the next team that has anyone).
create function saladbowl__peek(p_game uuid, p_from_team int) returns jsonb
language plpgsql set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  v_n int; v_team int; v_count int; v_player uuid; i int;
begin
  select * into g from saladbowl_games where id = p_game;
  v_n := jsonb_array_length(g.settings->'teams');
  for i in 0 .. v_n - 1 loop
    v_team := (greatest(coalesce(p_from_team, 0), 0) + i) % v_n;
    select count(*) into v_count from saladbowl_players where game_id = p_game and team = v_team and not removed;
    if v_count > 0 then
      select id into v_player from saladbowl_players
        where game_id = p_game and team = v_team and not removed
        order by (seat > coalesce(g.team_cursor[v_team + 1], 0)) desc, seat limit 1;
      return jsonb_build_object('team', v_team, 'playerId', v_player);
    end if;
  end loop;
  return null;
end $$;

-- Hand the mic to the next player, starting the search at p_from_team.
create function saladbowl__begin_turn(p_game uuid, p_from_team int) returns void
language plpgsql set search_path = public
as $$
declare
  v_next jsonb := saladbowl__peek(p_game, p_from_team);
  v_team int;
begin
  if v_next is null then return; end if;
  v_team := (v_next->>'team')::int;
  update saladbowl_games set
    current_team = v_team,
    current_player = (v_next->>'playerId')::uuid,
    -- team_cursor holds the seat number of each team's last clue-giver (0 =
    -- nobody yet); the next one up is the next higher seat, wrapping round.
    -- Counting seats rather than turns keeps the order right when people
    -- join, leave or switch teams mid-game.
    team_cursor[v_team + 1] = (select seat from saladbowl_players where id = (v_next->>'playerId')::uuid),
    turn_state = 'ready',
    current_word = null, word_shown_at = null, turn_ends_at = null,
    -- A teammate standing in for someone who held carried-over seconds
    -- inherits just those seconds, not a fresh full turn.
    turn_remaining_ms = case when current_team = v_team then turn_remaining_ms else null end,
    turn_skipped = '{}', turn_skips = 0, turn_words = '{}', buzzer_word = null, undo_word = null,
    turn_end_reason = null, leftover_ms = null, state_since = now()
  where id = p_game;
end $$;

-- End the live turn and open the "check your words" review.
-- p_reason: 'time' (buzzer), 'bowl' (bowl emptied), 'host' (host ended it).
create function saladbowl__to_review(p_game uuid, p_reason text, p_leftover int) returns void
language plpgsql set search_path = public
as $$
begin
  update saladbowl_games set
    turn_state = 'review',
    buzzer_word = case when p_reason = 'bowl' then null else current_word end,
    current_word = null, word_shown_at = null, turn_ends_at = null, turn_remaining_ms = null,
    turn_end_reason = p_reason, leftover_ms = p_leftover, state_since = now()
  where id = p_game;
end $$;

-- If the clock ran out (plus a short grace for a last-second tap), close the turn.
-- Caller must hold the game row lock. Returns true when it closed the turn.
create function saladbowl__expire(p_game uuid) returns boolean
language plpgsql set search_path = public
as $$
declare g saladbowl_games%rowtype;
begin
  select * into g from saladbowl_games where id = p_game;
  if g.status = 'playing' and g.turn_state = 'active' and g.turn_ends_at is not null
     and now() > g.turn_ends_at + interval '1200 milliseconds' then
    perform saladbowl__to_review(p_game, 'time', null);
    perform saladbowl__bump(p_game);
    return true;
  end if;
  return false;
end $$;

-- Leave the review / round-end screen for whatever comes next.
create function saladbowl__advance(p_game uuid) returns void
language plpgsql set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  v_rounds int;
  v_carry boolean;
begin
  select * into g from saladbowl_games where id = p_game;
  v_rounds := jsonb_array_length(g.settings->'rounds');

  if g.turn_state = 'review' then
    if saladbowl__left(p_game, g.round_index) = 0 then
      if g.round_index + 1 >= v_rounds then
        update saladbowl_games set status = 'finished', finished_at = now(),
          turn_state = 'round_end', state_since = now() where id = p_game;
      else
        update saladbowl_games set turn_state = 'round_end', state_since = now() where id = p_game;
      end if;
    else
      perform saladbowl__begin_turn(p_game, g.current_team + 1);
    end if;

  elsif g.turn_state = 'round_end' then
    if g.round_index + 1 >= v_rounds then
      update saladbowl_games set status = 'finished', finished_at = now(), state_since = now() where id = p_game;
      return;
    end if;
    -- Carry-over: whoever emptied the bowl keeps their unused seconds and
    -- opens the next round.
    v_carry := g.turn_end_reason = 'bowl'
      and coalesce((g.settings->>'carryOver')::boolean, true)
      and coalesce(g.leftover_ms, 0) >= 5000
      and exists (select 1 from saladbowl_players where id = g.current_player and not removed);
    update saladbowl_games set round_index = round_index + 1 where id = p_game;
    if v_carry then
      update saladbowl_games set
        turn_state = 'ready', turn_remaining_ms = g.leftover_ms,
        current_word = null, word_shown_at = null, turn_ends_at = null,
        turn_skipped = '{}', turn_skips = 0, turn_words = '{}', buzzer_word = null,
        turn_end_reason = null, leftover_ms = null, state_since = now()
      where id = p_game;
    else
      perform saladbowl__begin_turn(p_game, g.current_team + 1);
    end if;
  end if;
end $$;

-- The whole game as one player (or a spectator, p_me null) is allowed to see it.
create function saladbowl__state(p_game uuid, p_me uuid) returns jsonb
language plpgsql set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  me saladbowl_players%rowtype;
  v_teams jsonb;
  v_players jsonb;
  v_turn jsonb;
  v_word jsonb;
  v_words jsonb := '[]'::jsonb;
  v_my_words jsonb := '[]'::jsonb;
  v_deck jsonb;
  v_final jsonb;
  v_total int;
  v_left int;
  v_got int := 0;
  v_is_giver boolean := false;
  v_skip text;
  v_carry_next boolean := false;
begin
  select * into g from saladbowl_games where id = p_game;
  if p_me is not null then
    select * into me from saladbowl_players where id = p_me and game_id = p_game and not removed;
  end if;
  v_is_giver := me.id is not null and me.id = g.current_player;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.value->>'name',
      'adjust', coalesce(g.score_adjust[t.ord::int], 0),
      'score', (select count(*) from saladbowl_plays p
                where p.game_id = g.id and p.kind = 'got' and p.team = t.ord - 1)
               + coalesce(g.score_adjust[t.ord::int], 0),
      'rounds', (select coalesce(jsonb_agg(
                   (select count(*) from saladbowl_plays p
                    where p.game_id = g.id and p.kind = 'got' and p.team = t.ord - 1 and p.round_index = r.i)
                   order by r.i), '[]'::jsonb)
                 from generate_series(0, g.round_index) as r(i))
    ) order by t.ord), '[]'::jsonb)
  into v_teams
  from jsonb_array_elements(g.settings->'teams') with ordinality as t(value, ord);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'team', p.team, 'host', p.is_host, 'seat', p.seat,
      'online', p.last_seen_at > now() - interval '20 seconds',
      'words', (select count(*) from saladbowl_words w where w.player_id = p.id),
      'got', (select count(*) from saladbowl_plays x where x.game_id = g.id and x.player_id = p.id and x.kind = 'got')
    ) order by p.seat), '[]'::jsonb)
  into v_players
  from saladbowl_players p
  where p.game_id = g.id and not p.removed;

  if me.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'text', w.text) order by w.created_at, w.id), '[]'::jsonb)
    into v_my_words from saladbowl_words w
    where w.player_id = me.id and w.created_at >= me.token_issued_at;
  end if;

  select count(*) into v_total from saladbowl_words where game_id = g.id;
  v_left := case when g.status = 'lobby' then v_total else saladbowl__left(g.id, g.round_index) end;

  if g.status <> 'lobby' then
    if g.turn_state <> 'ready' then
      select count(*) into v_got from saladbowl_plays
      where game_id = g.id and round_index = g.round_index and turn_no = g.turn_no and kind = 'got';
    end if;

    -- The live word goes to the clue-giver only, and only while the clock runs.
    if v_is_giver and g.turn_state = 'active' and g.current_word is not null then
      select jsonb_build_object('id', w.id, 'text', w.text) into v_word
      from saladbowl_words w where w.id = g.current_word;
    end if;

    -- Review: the clue-giver sees every word from the turn (to fix mis-taps,
    -- including the one on screen at the buzzer); everyone else sees only
    -- the words that were won.
    if g.turn_state = 'review' then
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', w.id, 'text', w.text, 'got', x.got, 'buzzer', (g.buzzer_word is not null and w.id = g.buzzer_word)
        ) order by x.ord), '[]'::jsonb)
      into v_words
      from (
        select u.id, u.ord,
          exists (select 1 from saladbowl_plays p
                  where p.game_id = g.id and p.round_index = g.round_index and p.kind = 'got' and p.word_id = u.id) as got
        from unnest(g.turn_words || case when g.buzzer_word is null then '{}'::uuid[] else array[g.buzzer_word] end)
             with ordinality as u(id, ord)
      ) x
      join saladbowl_words w on w.id = x.id
      where v_is_giver or x.got;
    end if;

    v_skip := g.settings->>'skipRule';
    v_carry_next := g.turn_state = 'round_end' and g.status = 'playing'
      and g.turn_end_reason = 'bowl'
      and coalesce((g.settings->>'carryOver')::boolean, true)
      and coalesce(g.leftover_ms, 0) >= 5000;

    v_turn := jsonb_build_object(
      'state', g.turn_state,
      'no', g.turn_no,
      'team', g.current_team,
      'playerId', g.current_player,
      'endsAt', case when g.turn_ends_at is null then null
                     else floor(extract(epoch from g.turn_ends_at) * 1000)::bigint end,
      'remainingMs', g.turn_remaining_ms,
      'got', v_got,
      'skips', g.turn_skips,
      'canSkip', (v_skip = 'unlimited' or (v_skip = 'one' and g.turn_skips < 1)),
      'reason', g.turn_end_reason,
      'leftoverMs', g.leftover_ms,
      'carryNext', v_carry_next,
      'since', floor(extract(epoch from g.state_since) * 1000)::bigint,
      'word', v_word,
      'words', v_words
    );

    if v_carry_next
       or (g.turn_state = 'review' and g.status = 'playing' and v_left = 0
           and g.round_index + 1 < jsonb_array_length(g.settings->'rounds')
           and g.turn_end_reason = 'bowl'
           and coalesce((g.settings->>'carryOver')::boolean, true)
           and coalesce(g.leftover_ms, 0) >= 5000) then
      v_deck := jsonb_build_object('team', g.current_team, 'playerId', g.current_player);
    elsif g.turn_state = 'review' and g.status = 'playing' and v_left = 0
          and g.round_index + 1 >= jsonb_array_length(g.settings->'rounds') then
      v_deck := null; -- the game ends on the next tap
    else
      v_deck := saladbowl__peek(g.id, coalesce(g.current_team, 0) + 1);
    end if;
  end if;

  if g.status = 'finished' then
    v_final := jsonb_build_object(
      'mvp', (
        select jsonb_build_object('playerId', x.player_id, 'count', x.c)
        from (select player_id, count(*) as c from saladbowl_plays
              where game_id = g.id and kind = 'got' group by player_id) x
        order by x.c desc, x.player_id limit 1),
      'bestTurn', (
        select jsonb_build_object('playerId', x.player_id, 'count', x.c, 'round', x.round_index)
        from (select player_id, round_index, turn_no, count(*) as c from saladbowl_plays
              where game_id = g.id and kind = 'got' group by player_id, round_index, turn_no) x
        order by x.c desc, x.round_index, x.turn_no limit 1),
      'fastest', (
        select jsonb_build_object('text', w.text, 'ms', p.ms, 'playerId', p.player_id, 'round', p.round_index)
        from saladbowl_plays p join saladbowl_words w on w.id = p.word_id
        where p.game_id = g.id and p.kind = 'got' and p.ms is not null
        order by p.ms, p.id limit 1),
      'words', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'text', w.text,
            'author', a.name,
            'authorId', a.id,
            'ms', (select coalesce(sum(p.ms), 0) from saladbowl_plays p where p.word_id = w.id and p.kind = 'got'),
            'skips', (select count(*) from saladbowl_plays p where p.word_id = w.id and p.kind = 'skip')
          ) order by w.created_at, w.id), '[]'::jsonb)
        from saladbowl_words w join saladbowl_players a on a.id = w.player_id
        where w.game_id = g.id)
    );
  end if;

  return jsonb_build_object(
    'id', g.id,
    'code', g.code,
    'v', g.version,
    'now', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'status', g.status,
    'settings', g.settings,
    'teams', v_teams,
    'players', v_players,
    'me', case when me.id is null then null else jsonb_build_object(
      'id', me.id, 'name', me.name, 'team', me.team, 'host', me.is_host, 'words', v_my_words) end,
    'bowl', jsonb_build_object('total', v_total, 'left', v_left),
    'round', jsonb_build_object(
      'index', g.round_index,
      'type', g.settings->'rounds'->>g.round_index,
      'count', jsonb_array_length(g.settings->'rounds')),
    'turn', v_turn,
    'onDeck', v_deck,
    'final', v_final
  );
end $$;

-- ─── public API (anon-callable, SECURITY DEFINER) ────────────────────────────
-- Every function returns {"ok": true, ...} or {"ok": false, "error": "<code>"}.

-- Start a game. Returns the join code and the host's seat.
create function saladbowl_create(p_name text, p_settings jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := saladbowl__clean(p_name, 20);
  v_ip text;
  v_code text;
  v_game uuid;
  v_player uuid;
  v_token uuid;
  v_hdr json;
  v_tries int := 0;
  i int;
begin
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'name'); end if;

  -- Housekeeping: drop games nobody has touched for two days, and any game
  -- a week after it was made no matter what.
  delete from saladbowl_games
    where updated_at < now() - interval '48 hours' or created_at < now() - interval '7 days';

  -- Light abuse brake: per-network and overall.
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::json;
    v_ip := md5(coalesce(
      nullif(btrim(v_hdr->>'cf-connecting-ip'), ''),            -- set by the edge; a caller cannot fake it
      btrim(split_part(v_hdr->>'x-forwarded-for', ',', 1))));
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (select count(*) from saladbowl_games
      where creator_ip = v_ip and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if (select count(*) from saladbowl_games where created_at > now() - interval '1 hour') >= 600 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  loop
    v_tries := v_tries + 1;
    if v_tries > 200 then return jsonb_build_object('ok', false, 'error', 'rate_limited'); end if;
    v_code := '';
    for i in 1 .. 4 loop
      v_code := v_code || substr('BCDFGHJKLMNPQRSTVWXZ', 1 + floor(random() * 20)::int, 1);
    end loop;
    exit when not exists (select 1 from saladbowl_games where code = v_code);
  end loop;

  insert into saladbowl_games (code, settings, creator_ip)
    values (v_code, saladbowl__settings(p_settings, null), v_ip)
    returning id into v_game;
  insert into saladbowl_players (game_id, name, team, seat, is_host)
    values (v_game, v_name, 0, 1, true)
    returning id, token into v_player, v_token;
  insert into saladbowl_pulse (game_id, v) values (v_game, 1);

  return jsonb_build_object('ok', true, 'code', v_code, 'playerId', v_player, 'token', v_token);
end $$;

-- Take a seat in a game. No account: the returned token IS the seat.
create function saladbowl_join(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  v_name text := saladbowl__clean(p_name, 20);
  v_n int;
  v_team int;
  v_seat int;
  v_player uuid;
  v_token uuid;
begin
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;
  if g.status = 'finished' then return jsonb_build_object('ok', false, 'error', 'game_over'); end if;
  if (select count(*) from saladbowl_players where game_id = g.id and not removed) >= 40
     or (select count(*) from saladbowl_players where game_id = g.id) >= 200 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  if exists (select 1 from saladbowl_players
             where game_id = g.id and not removed and lower(name) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  -- Land on the smallest team; the host can move people afterwards.
  v_n := jsonb_array_length(g.settings->'teams');
  select t.i into v_team
  from generate_series(0, v_n - 1) as t(i)
  order by (select count(*) from saladbowl_players p where p.game_id = g.id and p.team = t.i and not p.removed), t.i
  limit 1;
  select coalesce(max(seat), 0) + 1 into v_seat from saladbowl_players where game_id = g.id;

  insert into saladbowl_players (game_id, name, team, seat)
    values (g.id, v_name, v_team, v_seat)
    returning id, token into v_player, v_token;
  perform saladbowl__bump(g.id);
  return jsonb_build_object('ok', true, 'code', g.code, 'playerId', v_player, 'token', v_token);
end $$;

-- Read the game. With a seat token: your view. Without: the spectator view.
-- Also closes a turn whose clock has run out, so any phone polling keeps the
-- game moving even if the clue-giver's phone dies.
create function saladbowl_state(p_code text, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  v_me uuid;
begin
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;

  if g.status = 'playing' and g.turn_state = 'active' and g.turn_ends_at is not null
     and now() > g.turn_ends_at + interval '1200 milliseconds' then
    perform 1 from saladbowl_games where id = g.id for update;
    perform saladbowl__expire(g.id);
  end if;

  if coalesce(p_token, '') <> '' then
    select id into v_me from saladbowl_players
      where game_id = g.id and token::text = p_token and not removed;
    if v_me is not null then
      update saladbowl_players set last_seen_at = now()
        where id = v_me and last_seen_at < now() - interval '5 seconds';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'seat', v_me is not null, 'state', saladbowl__state(g.id, v_me));
end $$;

-- Drop a word in the bowl (lobby only).
create function saladbowl_add_word(p_code text, p_token text, p_text text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  me saladbowl_players%rowtype;
  v_text text := saladbowl__clean(p_text, 40);
  v_norm text := saladbowl__norm(saladbowl__clean(p_text, 40));
  v_letter text;
begin
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;
  select * into me from saladbowl_players
    where game_id = g.id and token::text = coalesce(p_token, '') and not removed;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_seat'); end if;
  if g.status <> 'lobby' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if v_text = '' or v_norm = '' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if (select count(*) from saladbowl_words where player_id = me.id) >= (g.settings->>'wordsPerPlayer')::int then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  v_letter := g.settings->>'letter';
  if v_letter <> '' and upper(left(v_norm, 1)) <> v_letter then
    return jsonb_build_object('ok', false, 'error', 'letter');
  end if;
  if exists (select 1 from saladbowl_words where game_id = g.id and norm = v_norm) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  insert into saladbowl_words (game_id, player_id, text, norm) values (g.id, me.id, v_text, v_norm);
  perform saladbowl__bump(g.id);
  return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id));
end $$;

-- Take one of your own words back out (lobby only).
create function saladbowl_remove_word(p_code text, p_token text, p_word text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  me saladbowl_players%rowtype;
begin
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;
  select * into me from saladbowl_players
    where game_id = g.id and token::text = coalesce(p_token, '') and not removed;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_seat'); end if;
  if g.status <> 'lobby' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;

  delete from saladbowl_words where player_id = me.id and id::text = coalesce(p_word, '');
  if found then perform saladbowl__bump(g.id); end if;
  return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id));
end $$;

-- Everything only the host may do.
--   settings {..partial settings..}     assign {playerId, team}     shuffle
--   remove {playerId}                   reissue {playerId}          make_host {playerId}
--   start                               pause / resume / end_turn   skip_player
--   adjust {team, delta}                end_game                    rematch
create function saladbowl_host(p_code text, p_token text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  me saladbowl_players%rowtype;
  target saladbowl_players%rowtype;
  v_payload jsonb := case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end;
  v_new jsonb;
  v_n int;
  v_team int;
  v_delta int;
  v_token uuid;
  v_extra jsonb := '{}'::jsonb;
  v_is_current boolean;
begin
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;
  select * into me from saladbowl_players
    where game_id = g.id and token::text = coalesce(p_token, '') and not removed;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_seat'); end if;
  if not me.is_host then return jsonb_build_object('ok', false, 'error', 'not_host'); end if;

  if saladbowl__expire(g.id) then
    select * into g from saladbowl_games where id = g.id;
  end if;
  v_n := jsonb_array_length(g.settings->'teams');

  -- Actions aimed at one player share the lookup.
  if p_action in ('assign', 'remove', 'reissue', 'make_host') then
    select * into target from saladbowl_players
      where game_id = g.id and id::text = coalesce(v_payload->>'playerId', '') and not removed;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  end if;
  v_is_current := g.status = 'playing' and target.id is not null and target.id = g.current_player;

  if p_action = 'settings' then
    v_new := saladbowl__settings(v_payload, g.settings);
    if g.status <> 'lobby' then
      -- Mid-game the structure is frozen; timer, skip rule, theme text and
      -- team names can still change.
      v_new := v_new || jsonb_build_object(
        'rounds', g.settings->'rounds',
        'wordsPerPlayer', g.settings->'wordsPerPlayer',
        'letter', g.settings->'letter',
        'noProperNouns', coalesce(g.settings->'noProperNouns', 'false'::jsonb));
      if jsonb_array_length(v_new->'teams') <> v_n then
        v_new := v_new || jsonb_build_object('teams', g.settings->'teams');
      end if;
    else
      -- Fewer teams: fold the orphans back in.
      update saladbowl_players set team = seat % jsonb_array_length(v_new->'teams')
        where game_id = g.id and (team is null or team >= jsonb_array_length(v_new->'teams'));
      -- Fewer words each: keep each player's earliest ones.
      delete from saladbowl_words w using (
        select id, row_number() over (partition by player_id order by created_at, id) as rn
        from saladbowl_words where game_id = g.id
      ) x
      where w.id = x.id and x.rn > (v_new->>'wordsPerPlayer')::int;
      -- New letter rule: words that break it go back to their authors.
      if (v_new->>'letter') <> '' and (v_new->>'letter') is distinct from (g.settings->>'letter') then
        delete from saladbowl_words
          where game_id = g.id and upper(left(norm, 1)) <> (v_new->>'letter');
      end if;
    end if;
    update saladbowl_games set settings = v_new where id = g.id;

  elsif p_action = 'assign' then
    if jsonb_typeof(v_payload->'team') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if (v_payload->>'team')::numeric < 0 or (v_payload->>'team')::numeric >= v_n then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    v_team := floor((v_payload->>'team')::numeric)::int;
    if v_is_current and g.turn_state <> 'ready' then
      return jsonb_build_object('ok', false, 'error', 'busy');
    end if;
    update saladbowl_players set team = v_team where id = target.id;
    if v_is_current and target.team is distinct from v_team then
      perform saladbowl__begin_turn(g.id, g.current_team);
    end if;

  elsif p_action = 'shuffle' then
    if g.status <> 'lobby' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    update saladbowl_players p set team = (r.rn % v_n)::int
    from (
      select id, row_number() over (order by random()) - 1 as rn
      from saladbowl_players where game_id = g.id and not removed
    ) r
    where p.id = r.id;

  elsif p_action = 'remove' then
    if target.id = me.id then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    if v_is_current and g.turn_state <> 'ready' then
      return jsonb_build_object('ok', false, 'error', 'busy');
    end if;
    if g.status = 'lobby' then
      delete from saladbowl_players where id = target.id;
    else
      -- Mid-game their words stay in the bowl; only the seat goes.
      update saladbowl_players set removed = true, token = gen_random_uuid() where id = target.id;
      if v_is_current then perform saladbowl__begin_turn(g.id, g.current_team); end if;
    end if;

  elsif p_action = 'reissue' then
    -- New seat token (the old phone is signed out): for a lost or dead phone.
    -- Whoever holds the new token must not see words written under the old
    -- one (that would let a host read anyone's words): in the lobby the
    -- words are returned to the author to write again; mid-game they stay in
    -- the bowl but are no longer shown on that seat.
    if g.status = 'lobby' then
      delete from saladbowl_words where player_id = target.id;
    end if;
    update saladbowl_players set token = gen_random_uuid(), token_issued_at = clock_timestamp()
      where id = target.id returning token into v_token;
    v_extra := jsonb_build_object('playerId', target.id, 'name', target.name, 'token', v_token);

  elsif p_action = 'make_host' then
    update saladbowl_players set is_host = (id = target.id) where game_id = g.id;

  elsif p_action = 'start' then
    if g.status <> 'lobby' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if exists (
      select 1 from generate_series(0, v_n - 1) as t(i)
      where (select count(*) from saladbowl_players p
             where p.game_id = g.id and p.team = t.i and not p.removed) < 2
    ) then
      return jsonb_build_object('ok', false, 'error', 'need_players');
    end if;
    if (select count(*) from saladbowl_words where game_id = g.id) < 3 then
      return jsonb_build_object('ok', false, 'error', 'need_words');
    end if;
    delete from saladbowl_plays where game_id = g.id;
    update saladbowl_games set
      status = 'playing', started_at = now(), finished_at = null,
      round_index = 0, turn_no = 0,
      team_cursor = array[0, 0, 0, 0], score_adjust = array[0, 0, 0, 0]
    where id = g.id;
    perform saladbowl__begin_turn(g.id, floor(random() * v_n)::int);

  elsif p_action = 'pause' then
    if g.status = 'playing' and g.turn_state = 'active' then
      update saladbowl_games set
        turn_state = 'paused',
        turn_remaining_ms = greatest(0, floor(extract(epoch from (turn_ends_at - now())) * 1000)::int),
        turn_ends_at = null, state_since = now()
      where id = g.id;
    end if;

  elsif p_action = 'resume' then
    if g.status = 'playing' and g.turn_state = 'paused' then
      update saladbowl_games set
        turn_state = 'active',
        turn_ends_at = now() + make_interval(secs => coalesce(turn_remaining_ms, 0) / 1000.0),
        turn_remaining_ms = null,
        word_shown_at = coalesce(word_shown_at + (now() - state_since), now()),
        state_since = now()
      where id = g.id;
    end if;

  elsif p_action = 'end_turn' then
    if g.status = 'playing' and g.turn_state in ('active', 'paused') then
      perform saladbowl__to_review(g.id, 'host', null);
    end if;

  elsif p_action = 'skip_player' then
    -- "They're in the kitchen": pass to the next player on the same team.
    if g.status = 'playing' and g.turn_state = 'ready' then
      perform saladbowl__begin_turn(g.id, g.current_team);
    end if;

  elsif p_action = 'adjust' then
    if jsonb_typeof(v_payload->'team') is distinct from 'number'
       or jsonb_typeof(v_payload->'delta') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    if (v_payload->>'team')::numeric < 0 or (v_payload->>'team')::numeric >= v_n or g.status = 'lobby' then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end if;
    v_team := floor((v_payload->>'team')::numeric)::int;
    v_delta := sign((v_payload->>'delta')::numeric)::int;
    update saladbowl_games set score_adjust[v_team + 1] = coalesce(score_adjust[v_team + 1], 0) + v_delta
      where id = g.id;

  elsif p_action = 'end_game' then
    if g.status = 'playing' then
      update saladbowl_games set
        status = 'finished', finished_at = now(), turn_state = 'round_end',
        current_word = null, turn_ends_at = null, turn_remaining_ms = null, state_since = now()
      where id = g.id;
    end if;

  elsif p_action = 'rematch' then
    -- Encore: same crowd, same teams, empty bowl.
    if g.status = 'lobby' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    delete from saladbowl_plays where game_id = g.id;
    delete from saladbowl_words where game_id = g.id;
    delete from saladbowl_players where game_id = g.id and removed;
    update saladbowl_games set
      status = 'lobby', started_at = null, finished_at = null,
      round_index = 0, turn_no = 0, turn_state = 'ready',
      current_team = null, current_player = null,
      team_cursor = array[0, 0, 0, 0], score_adjust = array[0, 0, 0, 0],
      current_word = null, word_shown_at = null, turn_ends_at = null, turn_remaining_ms = null,
      turn_skipped = '{}', turn_skips = 0, turn_words = '{}', buzzer_word = null, undo_word = null,
      turn_end_reason = null, leftover_ms = null, state_since = now()
    where id = g.id;

  else
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  perform saladbowl__bump(g.id);
  return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id)) || v_extra;
end $$;

-- What happens during a turn.
--   start                      (clue-giver)  ready → clock starts, first word drawn
--   correct {wordId}           (clue-giver)  team scores, next word
--   skip {wordId}              (clue-giver)  per the host's skip rule
--   undo {got}                 (clue-giver)  take back the last "got it"
--   toggle {wordId, got}       (clue-giver or host) fix the tally in review
--   advance {since}            pass the mic / start the next round
create function saladbowl_turn(p_code text, p_token text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g saladbowl_games%rowtype;
  me saladbowl_players%rowtype;
  v_payload jsonb := case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end;
  v_word text := coalesce(v_payload->>'wordId', '');
  v_is_giver boolean;
  v_next uuid;
  v_last saladbowl_plays%rowtype;
  v_skip text;
  v_since bigint;
  v_age interval;
  v_ms int;
begin
  select * into g from saladbowl_games where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_game'); end if;
  select * into me from saladbowl_players
    where game_id = g.id and token::text = coalesce(p_token, '') and not removed;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_seat'); end if;
  if g.status <> 'playing' then
    return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id));
  end if;

  if saladbowl__expire(g.id) then
    select * into g from saladbowl_games where id = g.id;
  end if;
  v_is_giver := me.id = g.current_player;

  if p_action = 'start' then
    if not v_is_giver then return jsonb_build_object('ok', false, 'error', 'not_your_turn'); end if;
    if g.turn_state = 'ready' then
      v_next := saladbowl__draw(g.id, g.round_index, '{}');
      if v_next is null then
        perform saladbowl__to_review(g.id, 'bowl', null);
      else
        update saladbowl_games set
          turn_state = 'active', turn_no = turn_no + 1,
          turn_ends_at = now() + make_interval(secs =>
            coalesce(turn_remaining_ms, (settings->>'turnSeconds')::int * 1000) / 1000.0),
          turn_remaining_ms = null,
          current_word = v_next, word_shown_at = now(),
          turn_skipped = '{}', turn_skips = 0, turn_words = '{}', buzzer_word = null, undo_word = null,
          turn_end_reason = null, leftover_ms = null, state_since = now()
        where id = g.id;
      end if;
      perform saladbowl__bump(g.id);
    end if;

  elsif p_action = 'correct' then
    if not v_is_giver then return jsonb_build_object('ok', false, 'error', 'not_your_turn'); end if;
    -- wordId makes a double tap or a retried request harmless.
    if g.turn_state = 'active' and g.current_word is not null and g.current_word::text = v_word then
      v_ms := least(greatest(floor(extract(epoch from (now() - coalesce(g.word_shown_at, now()))) * 1000), 0), 600000)::int;
      insert into saladbowl_plays (game_id, round_index, turn_no, word_id, player_id, team, kind, ms)
        values (g.id, g.round_index, g.turn_no, g.current_word, me.id, g.current_team, 'got', v_ms)
        on conflict do nothing;
      update saladbowl_games set
        turn_words = array_append(array_remove(turn_words, g.current_word), g.current_word)
      where id = g.id;
      -- If an undo pushed a word off the screen, that word comes straight
      -- back: otherwise got-it, undo, got-it would be a free skip.
      v_next := null;
      if g.undo_word is not null and g.undo_word <> g.current_word and not exists (
           select 1 from saladbowl_plays
           where game_id = g.id and round_index = g.round_index and kind = 'got' and word_id = g.undo_word) then
        v_next := g.undo_word;
      end if;
      if v_next is null then
        v_next := saladbowl__draw(g.id, g.round_index, g.turn_skipped);
      end if;
      if v_next is null then
        -- Nothing fresh: fall back to words skipped earlier this turn.
        v_next := saladbowl__draw(g.id, g.round_index, '{}');
      end if;
      if v_next is null then
        perform saladbowl__to_review(g.id, 'bowl',
          greatest(0, floor(extract(epoch from (g.turn_ends_at - now())) * 1000)::int));
      else
        update saladbowl_games set current_word = v_next, word_shown_at = now(), undo_word = null where id = g.id;
      end if;
      perform saladbowl__bump(g.id);
    end if;

  elsif p_action = 'skip' then
    if not v_is_giver then return jsonb_build_object('ok', false, 'error', 'not_your_turn'); end if;
    if g.turn_state = 'active' and g.current_word is not null and g.current_word::text = v_word then
      v_skip := g.settings->>'skipRule';
      if v_skip = 'none' or (v_skip = 'one' and g.turn_skips >= 1) then
        return jsonb_build_object('ok', false, 'error', 'no_skips');
      end if;
      v_next := saladbowl__draw(g.id, g.round_index, array_append(g.turn_skipped, g.current_word));
      if v_next is null then
        -- Only skipped words are left: cycle back through them.
        v_next := saladbowl__draw(g.id, g.round_index, array[g.current_word]);
      end if;
      if v_next is null then
        return jsonb_build_object('ok', false, 'error', 'last_word');
      end if;
      -- The skip always happens; only the statistics row is capped, so one
      -- game can never grow without bound.
      if (select count(*) from saladbowl_plays where game_id = g.id and kind = 'skip') < 5000 then
        insert into saladbowl_plays (game_id, round_index, turn_no, word_id, player_id, team, kind)
          values (g.id, g.round_index, g.turn_no, g.current_word, me.id, g.current_team, 'skip');
      end if;
      update saladbowl_games set
        turn_skipped = array_append(array_remove(turn_skipped, g.current_word), g.current_word),
        turn_skips = turn_skips + 1,
        current_word = v_next, word_shown_at = now()
      where id = g.id;
      perform saladbowl__bump(g.id);
    end if;

  elsif p_action = 'undo' then
    if not v_is_giver then return jsonb_build_object('ok', false, 'error', 'not_your_turn'); end if;
    if g.turn_state = 'active' then
      select * into v_last from saladbowl_plays
        where game_id = g.id and round_index = g.round_index and turn_no = g.turn_no and kind = 'got'
        order by id desc limit 1;
      -- {got} is the tally the phone saw, so a double tap undoes only one.
      if found and (v_payload->>'got') is not distinct from (
           select count(*)::text from saladbowl_plays
           where game_id = g.id and round_index = g.round_index and turn_no = g.turn_no and kind = 'got') then
        delete from saladbowl_plays where id = v_last.id;
        update saladbowl_games set
          turn_words = array_remove(turn_words, v_last.word_id),
          undo_word = coalesce(undo_word, current_word),
          current_word = v_last.word_id,
          word_shown_at = now() - make_interval(secs => coalesce(v_last.ms, 0) / 1000.0)
        where id = g.id;
        perform saladbowl__bump(g.id);
      end if;
    end if;

  elsif p_action = 'toggle' then
    if not (v_is_giver or me.is_host) then return jsonb_build_object('ok', false, 'error', 'not_your_turn'); end if;
    if g.turn_state = 'review'
       and exists (select 1 from unnest(g.turn_words || array[g.buzzer_word]) as u(id) where u.id::text = v_word) then
      if (v_payload->'got') = 'true'::jsonb then
        insert into saladbowl_plays (game_id, round_index, turn_no, word_id, player_id, team, kind)
          values (g.id, g.round_index, g.turn_no, v_word::uuid, g.current_player, g.current_team, 'got')
          on conflict do nothing;
      else
        delete from saladbowl_plays
          where game_id = g.id and round_index = g.round_index and kind = 'got' and word_id::text = v_word;
      end if;
      perform saladbowl__bump(g.id);
    end if;

  elsif p_action = 'advance' then
    if g.turn_state in ('review', 'round_end') then
      -- {since} pins the request to the screen it was tapped on, so two
      -- people tapping "next" at once move the game one step, not two.
      begin
        v_since := (v_payload->>'since')::numeric::bigint;
      exception when others then
        v_since := null;
      end;
      if v_since is null or v_since <> floor(extract(epoch from g.state_since) * 1000)::bigint then
        return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id));
      end if;
      -- The clue-giver or host moves on at once; after a pause anyone may,
      -- so a distracted player can't stall the room.
      v_age := now() - g.state_since;
      if not (v_is_giver or me.is_host
              or v_age > (case when g.turn_state = 'review' then interval '15 seconds' else interval '8 seconds' end)) then
        return jsonb_build_object('ok', false, 'error', 'wait');
      end if;
      perform saladbowl__advance(g.id);
      perform saladbowl__bump(g.id);
    end if;

  else
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  return jsonb_build_object('ok', true, 'state', saladbowl__state(g.id, me.id));
end $$;

-- ─── privileges ──────────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'saladbowl\_%'
  loop
    execute 'revoke all on function ' || r.sig || ' from public, anon, authenticated';
    if r.proname not like 'saladbowl\_\_%' then
      execute 'grant execute on function ' || r.sig || ' to anon, authenticated';
    end if;
  end loop;
end $$;
