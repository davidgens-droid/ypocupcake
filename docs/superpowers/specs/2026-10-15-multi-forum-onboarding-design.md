# Multi-forum onboarding — design

**Date:** 2026-10-15 · **Status:** approved in conversation, pending written review · **Approach:** C (harden in place + RPC onboarding + platform operator layer)

## 1. Goal

Let other YPO forums sign up and use Cupcake, with a hard guarantee that:

- no member's confidential data (updates, QoL numbers, AI interactions, notifications, pattern cards) is readable by any other member — including their own moderator and admin — except the existing QoL-history carve-out;
- nothing readable or writable crosses forums.

Non-goals (follow-ons): member offboarding/anonymisation, forum deletion/export, billing, multiple forums per account, subdomains, per-forum AI budgets as settings.

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Who creates a forum | Self-serve: anyone with an email creates a forum and is its first admin |
| How members join | Shareable invite link, expiring and capped, revocable, with a visible joiner list |
| Forums per account | Exactly one, for the account's lifetime |
| Isolation model | Logical: one Supabase project, `members.forum_id` as the single anchor, every guarantee enforced in Postgres (RLS, grants, triggers, composite FKs) |
| Operator | A `platform_admins` table (keyed on `auth.users.id`), blind to member content by construction |

## 3. Current state (from the 2026-10-15 audit)

Already true: every table is forum-scoped by RLS through `current_member_forum()` (`members.forum_id` for `auth.uid()`); member-private tables are `member_id = auth.uid()` FOR ALL; the service-role key is unused in `src/`; storage objects live under `<forum_id>/<member_id>/`; no server caching.

Holes that become exploitable with a second forum (file:line in the audit synthesis):

1. `members_self_update` has no column restriction → a member can set their own `forum_id` (forum hop) or `is_admin`.
2. Realtime `REPLICA IDENTITY FULL` on meetings, meeting_rounds, attendees, notifications → DELETE events broadcast full old rows to any subscriber, ignoring RLS (UUID source for every other attack).
3. `create_notification()` is SECURITY DEFINER, executable by anyone, with no forum check and an unvalidated link the bell follows.
4. `has_role()` ignores `forum_id`; roles can be granted across forums; a dozen role lookups in app code have no forum filter.
5. `member_invites.email` is a global primary key; `handle_new_user` only admits people who were invited before their first login.
6. Repo/live policy drift: app code depends on a `forums` UPDATE policy and admin member UPDATE/DELETE policies that the migrations don't contain.
7. Many write policies pin only `auth.uid()`, so client-supplied UUIDs (meeting, submitter, photo, parking-lot item) can point into another forum.
8. Hard-coded `FORUM_TZ` and ~15 "Cupcake" literals; forums resolved by display name.

## 4. Data model

### 4.1 New and changed columns

- `forums`: add `timezone text not null default 'America/Vancouver'`, `status text not null default 'active' check (status in ('active','suspended'))`, `created_by uuid references auth.users(id)`. `name` stays (not unique). `settings` jsonb (charter) stays. No slug.
- `members`: add `status text not null default 'active' check (status in ('active','removed'))` and `joined_via_link_id uuid null references forum_invite_links(id)`. `unique (id, forum_id)`.
- `meetings`, `photos`, `parking_lot_items`, `photo_albums`: `unique (id, forum_id)`.
- `meeting_rounds`, `attendees`, `agenda_items`: add `forum_id uuid not null` (backfilled from the parent meeting; kept in sync by a `BEFORE INSERT/UPDATE` trigger that copies it from `meetings` and refuses a mismatch).
- New `forum_invite_links` (`id uuid pk`, `forum_id`, `token text unique` — 32 random bytes base64url, `created_by`, `created_at`, `expires_at` default `now() + interval '14 days'`, `max_uses int` default 25 (null = unlimited), `uses int default 0`, `revoked_at timestamptz`). One *active* link per forum is a UI rule, not a constraint.
- New `platform_admins` (`user_id uuid pk references auth.users(id)`, `created_at`). Seeded with the owner's account by migration (lookup by email at migration time).
- Dropped: `member_invites` and the `handle_new_user` trigger (after confirming no pending invites; the join RPC replaces them).

### 4.2 Composite foreign keys (same-forum by construction)

Every reference to a forum-owned row becomes `(x_id, forum_id) → parent(id, forum_id)`:
`roles.member_id`, `meetings.host_member_id`, `parking_lot_items.{submitter_member_id, added_by_member_id, scheduled_meeting_id, captured_meeting_id}`, `commitments.{member_id, meeting_id}`, `photos.{uploader_member_id, album_id}`, `photo_albums.cover_photo_id`, `agenda_items.{meeting_id, parking_lot_item_id}`, `meeting_rounds.{meeting_id, parking_lot_item_id}`, `attendees.{meeting_id, member_id}`, `forum_invite_links.{forum_id, created_by (via members)}`.
`meeting_rounds.order_member_ids` (uuid[]) is validated by a trigger: every id must be an active member of the round's forum.

## 5. Isolation primitives

### 5.1 Immutable anchor
- `revoke update on members from authenticated; grant update (name, photo_url, family, birthday, anniversary) on members to authenticated;`
- `BEFORE UPDATE` trigger on `members` raises if `id`, `forum_id`, `is_admin`, `email` or `status` change, unless `current_user` is the definer role of our own RPCs (functions below run as owner).
- `admin_update_member(member_id, patch jsonb)` SECURITY DEFINER: caller must be `is_admin` in the same forum; patch may touch `name, photo_url, family, birthday, anniversary, is_admin`; never `forum_id`, `id`, `email`.
- `remove_member(member_id)` / `restore_member(member_id)`: same-forum admin; sets `status`; refuses to remove the last admin or the caller.
- `current_member_forum()` returns the forum only for `status = 'active'` members of an `active` forum (so removal and suspension end access everywhere at once). A second function, `current_member_forum_any()`, is used only by the suspended-forum page.

### 5.2 Roles
- `has_role(p_role)` adds `and forum_id = current_member_forum() and status = 'active'` (via the member) — forum-scoped.
- `roles_admin_write` requires `member_id` ∈ forum (guaranteed by the composite FK) and caller `is_admin` in that forum.
- One `getMyRoles(me)` helper in app code replaces the twelve ad-hoc lookups; it filters by `me.forum_id`.

### 5.3 Write policies
Every self-write policy gets an explicit `with check`: the row's `forum_id = current_member_forum()` where the column exists; otherwise its parent is in the caller's forum (`meeting_id in (select id from meetings where forum_id = current_member_forum())`, `photo_id in (...)`). Privileged inserts (`parking_lot_privileged_insert`, captured items) require the submitter and the meeting to be in-forum. Composite FKs make this belt-and-braces.

### 5.4 SECURITY DEFINER hygiene
Boilerplate for every function: `set search_path = public`, `revoke execute from public, anon`, `grant execute to authenticated`, first statement `if auth.uid() is null then raise`. `create_notification`: recipient must be an active member of the caller's forum; `kind` from an allowlist; `link` must start with `/` and not `//`; actor name read from the caller's members row, never from the argument. The notifications bell only navigates to relative links.

### 5.5 Member-private tables — unchanged, and guarded
`updates`, `ai_interactions`, `ai_pattern_cards`, `notifications` keep exactly their self-only FOR ALL policy. The isolation suite asserts `pg_policies` for these tables contains only that policy; any extra policy fails the suite. The only carve-out remains `forum_qol_history()` (role-gated, forum-filtered, four integers).

### 5.6 Side channels
- Realtime: `alter table meetings, meeting_rounds, attendees, notifications replica identity default` — a DELETE event then carries only the PK. `updates`, `parking_lot_items`, `ai_*` stay unpublished.
- Storage: single `photos` bucket, `<forum_id>/<member_id>/` convention unchanged; `recordPhoto` asserts the prefix; signed-URL TTL 10 minutes.
- Auth callback stops logging query parameters.

## 6. Onboarding flow

### 6.1 Routes
Public (added to the proxy allowlist): `/signup`, `/join/[token]`. Authenticated but membership-less: `/onboarding`. The `(app)` layout redirects an authenticated user with no active membership to `/onboarding` (today: `/login`); a member of a suspended forum to `/suspended`.

### 6.2 Create a forum
`/signup` = the code-login form with "setting up a new forum" copy. After verification → `/onboarding`: **Create a forum** (forum name, your name, timezone pre-filled from `Intl.DateTimeFormat().resolvedOptions().timeZone`) or **Have an invite link?** (paste → `/join/<token>`).

`create_forum(p_name text, p_timezone text, p_admin_name text) returns uuid` — SECURITY DEFINER, single transaction:
1. `auth.uid()` must exist and must have **no** `members` row (any status, any forum) → else raise `already_member`.
2. Validate: name 2–80 chars; timezone ∈ `pg_timezone_names`.
3. Insert `forums` (`status active`, `created_by = auth.uid()`).
4. Insert `members` (`id = auth.uid()`, `email` from `auth.users`, `is_admin true`, `status active`).
5. Insert `roles` for `extract(year from now())`: `moderator`, `technology`.
6. Return the forum id.

Then → `/dashboard` with a first-run checklist card (shown while the forum has < 2 members or no meeting): *Invite your members · Schedule your first meeting · Write your charter*.

### 6.3 Join via link
Admin → **Invite link** page (`/admin/invite`): shows the active link (`https://<host>/join/<token>`, copy button), expiry and uses `n / max`, **Revoke**, **New link** (revokes the previous), editable expiry (1–90 days) and cap (1–200 or unlimited), and the joiner list (name, joined-at, which link).

`/join/[token]`: `peek_invite(p_token) returns (forum_name text, valid boolean, reason text)` — SECURITY DEFINER; returns only the forum name and a reason code (`expired`, `revoked`, `exhausted`, `unknown`). If not signed in, the code-login form renders inline and returns to the same URL. If the caller already belongs to a forum: explain one forum per account (name the forum; "sign in with a different email to join another"). Otherwise: "Join *<forum name>*" + name field → `join_forum(p_token, p_name) returns uuid`:
1. `auth.uid()` must exist and have no `members` row.
2. Lock the link row; require unrevoked, unexpired, `uses < max_uses` (if set), forum `active`.
3. Insert `members` (`is_admin false`, `status active`), `uses = uses + 1`, record `joined_via_link_id` on the member.
4. Return the forum id → `/dashboard`.

### 6.4 Remove / restore
Admin → Members: **Remove** → `remove_member`; the row stays (`status removed`), private data stays theirs, FKs stay valid, access ends immediately. **Restore** reverses. A removed account cannot join a different forum (one forum per account); the onboarding page says so.

### 6.5 Retire the allowlist
Drop `member_invites`, `handle_new_user` and the admin invite-by-email UI, after a one-off check that no pending Cupcake invites exist.

## 7. Per-forum settings and de-hardcoding

- `getCurrentMember()` joins `forums` and returns `me.forum = { id, name, timezone, status }`.
- `src/lib/dates.ts` helpers take `timezone`; `FORUM_TZ` is deleted; every call site passes `me.forum.timezone` (server) or a `timezone` prop (client). Migration sets Cupcake to `America/Vancouver`.
- Naming rule: "Cupcake" = product (login, app title, email sender, prompts' "a YPO forum companion app"); the forum's name replaces the literal wherever it is read as *their forum* (nav header, dashboard heading, print/export headers, email subject).
- Admin → **Forum settings**: name, timezone (charter stays where it is). Saved through `update_forum_settings(p_name, p_timezone)` (same-forum admin) rather than a broad UPDATE policy; charter save moves to the same RPC.

## 8. Platform operator layer

- `is_platform_admin()`: `exists (select 1 from platform_admins where user_id = auth.uid())`.
- `/platform` (404 unless platform admin): table of forums — name, status, created, founder name + email, member count, meeting count, AI calls (30 days), last activity — from `platform_forum_stats()` SECURITY DEFINER, which returns exactly those columns. **No table gets a platform-wide SELECT policy.**
- `platform_set_forum_status(p_forum_id, p_status)`: suspend / reactivate.
- Nav shows "Platform" only when `is_platform_admin()`.

## 9. AI fair use

Per-forum cap 300 AI calls/day, per-member 60/day, counted from `ai_interactions` (joined to members for the forum); exceeded → the existing "AI is busy" message. Every Anthropic request sets `metadata.user_id = sha256(forum_id || ':' || member_id)`. Constants in `src/lib/ai/limits.ts`.

## 10. App changes (summary)

New: `/signup`, `/onboarding`, `/join/[token]`, `/suspended`, `/admin/invite`, `/admin/settings`, `/platform`; `src/lib/forums/actions.ts` (thin wrappers over the RPCs, returning `{ok,error}`); first-run checklist card; invite-link admin component; platform table. Changed: proxy allowlist; `(app)` layout redirect; `getCurrentMember`; `dates.ts` signature and call sites; `getMyRoles`; `recordPhoto`; notifications bell link check; `admin` member edits → RPC; auth callback logging; Anthropic metadata; AI cap checks in each AI action.

## 11. Error handling

RPCs raise with stable codes (`already_member`, `invalid_token`, `expired`, `revoked`, `exhausted`, `forum_suspended`, `not_admin`, `last_admin`); wrappers map codes to copy and return `{ok:false,error}` (production scrubs thrown messages). Signup/join pages never reveal whether an email belongs to another forum except to the signed-in owner of that email.

## 12. Verification

`scripts/isolation-test.mjs` (committed; `npm run test:isolation`) against a **test Supabase project** configured in `.env.test.local` (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`). Steps: reset schema; apply `supabase/migrations/*` in order; create auth users with the admin API (no OTP); create forum A (admin a1, member a2) and forum B (admin b1, member b2) — through Phase 2 the fixtures are inserted with the service role (the onboarding RPCs don't exist yet), from Phase 3 on they are created through the real `create_forum` / `join_forum` RPCs; sign in each user as themselves; assert:

1. every forum-scoped table returns 0 rows of the other forum for every role;
2. every write with a foreign UUID (meeting, submitter, photo, parking-lot item, member in `order_member_ids`) is rejected;
3. `PATCH members` changing `forum_id`, `is_admin`, `email`, `status`, `id` is rejected; allowed columns succeed;
4. a role granted to a B member by A's admin is rejected; `has_role` never true across forums;
5. `create_notification` to a B member from A is rejected; non-relative links rejected;
6. storage upload with a foreign prefix is rejected; signed URL for another forum's object fails;
7. a realtime DELETE payload for meetings/meeting_rounds/attendees/notifications contains only the PK;
8. `updates`, `ai_interactions`, `ai_pattern_cards`, `notifications`: admin and moderator see 0 rows of other members; `pg_policies` for these tables is exactly the self-only policy;
9. `forum_qol_history()` returns only same-forum rows and only to the three roles;
10. `create_forum` refuses an existing member; `join_forum` refuses expired/revoked/exhausted/foreign-forum-member; `peek_invite` leaks nothing but the name;
11. platform RPCs refuse non-platform users; `platform_forum_stats` returns no member-level columns;
12. `grep -r SUPABASE_SERVICE_ROLE_KEY src/` is empty.

Plus adversarial review workflows per phase and a browser smoke test (sign up → create → invite link → join from a second profile) against the test project.

## 13. Rollout

| Phase | Migration(s) | Deploy | Gate |
|---|---|---|---|
| 0 Reconcile | `0016_reconcile_live_policies.sql` (live `pg_policies`/`pg_proc` diff) | none | — |
| 1 Fence | `0017_isolation_anchor.sql`, `0018_isolation_fks_policies.sql`, `0019_isolation_functions_realtime.sql` | admin RPC, bell, photo TTL/path, callback log | isolation suite §12.1–9 green on test project |
| 2 Forum settings | `0020_forum_settings.sql` | timezone/name plumbing, AI caps | suite green |
| 3 Onboarding | `0021_onboarding.sql` (invite links, RPCs, drop allowlist) | routes + admin pages, `SIGNUP_ENABLED=false` | suite §12.10 green; Resend SMTP configured; then flip the flag |
| 4 Platform | `0022_platform.sql` | `/platform` | suite §12.11 green |

Each migration is idempotent and applied by the owner in the Supabase SQL editor, in order, with a one-line checklist per phase.

## 14. Owner prerequisites

1. Create a free test Supabase project; put its URL and keys in `.env.test.local`.
2. Configure Resend custom SMTP in Supabase Auth and raise the email rate limit (before Phase 3's flag flips).
3. Confirm Supabase Auth "Enable signups" is on (it is today — OTP creates users).
