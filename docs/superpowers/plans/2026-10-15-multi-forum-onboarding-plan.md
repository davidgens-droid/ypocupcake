# Multi-forum onboarding — implementation plan

Spec: `docs/superpowers/specs/2026-10-15-multi-forum-onboarding-design.md`. Each phase ends with: typecheck, lint, build, the isolation suite where applicable, an adversarial review, a commit, and the migration(s) handed to the owner with a checklist line. Migrations are idempotent (`drop … if exists` / `add column if not exists` / `create or replace`).

## Phase 0 — Reconcile the live database (no code)

- [ ] Owner runs the two catalog queries (policies + function bodies) in the SQL editor and shares the output.
- [ ] Diff against `supabase/migrations/*`; write `0016_reconcile_live_policies.sql` that recreates any out-of-band policy/function exactly as live (so the repo is the truth), or records "no drift".

## Phase 1 — The fence

### 1a `0017_isolation_anchor.sql`
- [ ] `members.status` (`active`/`removed`), `members.joined_via_link_id` (FK added in 0021), `unique (id, forum_id)`.
- [ ] Column-level `UPDATE` grant on `members`; `revoke update` for `authenticated`.
- [ ] `members_guard_identity()` BEFORE UPDATE trigger: refuses changes to `id, forum_id, is_admin, email, status` unless running as the function owner.
- [ ] `current_member_forum()` → active member of an active forum only; `current_member_forum_any()`.
- [ ] `admin_update_member(member_id, patch)`, `remove_member(member_id)`, `restore_member(member_id)` RPCs (same-forum admin; last-admin / self guards).
- [ ] `forums.status` column (needed by `current_member_forum()`), default `active`.

### 1b `0018_isolation_fks_policies.sql`
- [ ] `forum_id` on `meeting_rounds`, `attendees`, `agenda_items` (backfill from `meetings`; sync trigger).
- [ ] `unique (id, forum_id)` on `meetings`, `photos`, `photo_albums`, `parking_lot_items`.
- [ ] Composite FKs listed in spec §4.2; `order_member_ids` validation trigger.
- [ ] `has_role()` forum-scoped.
- [ ] `with check` on every self-write policy; privileged inserts require in-forum submitter + meeting.

### 1c `0019_isolation_functions_realtime.sql`
- [ ] SECURITY DEFINER hygiene on every function (search_path, revoke public/anon, auth.uid() guard).
- [ ] `create_notification` hardening (in-forum recipient, kind allowlist, relative link, server-derived actor).
- [ ] `replica identity default` on meetings, meeting_rounds, attendees, notifications.

### 1d App
- [ ] `src/lib/admin/actions.ts`: member edits → `admin_update_member`; Remove/Restore actions + UI on Admin → Members.
- [ ] `src/lib/auth/roles.ts`: `getMyRoles(me)`; replace the twelve ad-hoc lookups.
- [ ] Notifications bell: only relative links.
- [ ] `recordPhoto` path assertion; signed URL TTL 10 min.
- [ ] Auth callback: remove query-param logging.
- [ ] Every server action that takes a client UUID (meeting, submitter, photo, item): `.eq("forum_id", me.forum_id)` guard (belt to the DB's braces).

### 1e Verification
- [ ] `scripts/isolation-test.mjs` + `npm run test:isolation` (fixtures via service role for now); assertions §12.1–9.
- [ ] Adversarial review workflow (SQL + app); fix; commit.

## Phase 2 — Forum settings, de-hardcoding, AI caps

- [ ] `0020_forum_settings.sql`: `forums.timezone`, `forums.created_by`; backfill Cupcake tz; `update_forum_settings(p_name, p_timezone, p_charter)` RPC replacing the charter UPDATE path.
- [ ] `getCurrentMember()` returns `me.forum`; `/suspended` page; `(app)` layout redirect rules.
- [ ] `src/lib/dates.ts` takes `timezone`; replace `FORUM_TZ` at every call site; client components receive `timezone` props.
- [ ] Forum-name substitution (nav, dashboard, print/export, email subject); product mentions stay.
- [ ] Admin → Forum settings page.
- [ ] `src/lib/ai/limits.ts` + checks in brain-dump, interview, patterns, listening, merge, tts; `metadata.user_id` hash on Anthropic calls.
- [ ] Review; commit.

## Phase 3 — Onboarding

- [ ] `0021_onboarding.sql`: `forum_invite_links`; `members.joined_via_link_id` FK; `create_forum`, `peek_invite`, `join_forum`, `create_invite_link`, `revoke_invite_link` RPCs; drop `member_invites` + `handle_new_user` (after the pending-invite check).
- [ ] Proxy allowlist: `/signup`, `/join`; `(app)` layout: membership-less → `/onboarding`.
- [ ] Pages: `/signup`, `/onboarding`, `/join/[token]`, `/admin/invite`; `src/lib/forums/actions.ts` wrappers; first-run checklist card on the dashboard.
- [ ] `SIGNUP_ENABLED` flag (env) gating `/signup` and the login-page link.
- [ ] Isolation suite: fixtures switch to the RPCs; assertions §12.10.
- [ ] Browser smoke test against the test project; review; commit. Flag stays off until SMTP is configured.

## Phase 4 — Platform layer

- [ ] `0022_platform.sql`: `platform_admins` (seeded), `is_platform_admin()`, `platform_forum_stats()`, `platform_set_forum_status()`.
- [ ] `/platform` page + nav link; suite assertions §12.11; review; commit.

## Owner checklist (per phase)

**Ordering rule for every phase: run the phase's migrations in the SQL editor BEFORE the matching code is pushed to `main`** (Vercel deploys on push, and the new code reads columns/RPCs the migrations create — deploying first would break member lists and rounds until the SQL is run). Phase commits therefore stay local until the migrations are confirmed applied.

0. Run catalog queries → share output.
1. Run 0016 (if any), 0017, 0018, 0019 in order → say so → code is pushed → confirm Admin → Members still edits/removes, a round can be started, charter saves, photos upload.
2. Run 0020 → confirm meeting times unchanged (Vancouver).
3. Run 0021 → create the test project keys in `.env.test.local` (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, `TEST_DATABASE_URL` from the test project's Settings → Database) — needed from Phase 1's verification onward → configure Resend SMTP → set `SIGNUP_ENABLED=true` in Vercel.
4. Run 0022 → open `/platform`.
