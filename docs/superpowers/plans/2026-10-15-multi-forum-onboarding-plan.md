# Multi-forum onboarding — implementation plan

Spec: `docs/superpowers/specs/2026-10-15-multi-forum-onboarding-design.md`. Each phase ends with: typecheck, lint, build, the isolation suite where applicable, an adversarial review, a commit, and the migration(s) handed to the owner with a checklist line. Migrations are idempotent (`drop … if exists` / `add column if not exists` / `create or replace`).

## Phase 0 — Reconcile the live database (no code) — done 2026-10-15

- [x] Owner ran the four catalog queries (`phase0-catalog-queries.sql`: policies, function bodies, triggers, table grants) in the SQL editor; output in `catalog-1..4.csv` (not committed).
- [x] Diffed against `supabase/migrations/0001–0014`: **no drift.** All 40 live policies, all 6 functions and both triggers are exactly the migrations' (the audit's "app depends on a forums UPDATE policy that doesn't exist" was true of the live DB too — those writes were silently no-ops; 0017/0020 route them through RPCs). Table grants are Supabase defaults. 0015 was deliberately not applied, and the isolation suite now skips it to match. **No `0016` is needed; the production sequence is 0017 → 0018 → 0019 → 0020.**

## Phase 1 — The fence

### 1a `0017_isolation_anchor.sql` — done (commit d192d57)
- [x] `members.status` (`active`/`removed`), `members.joined_via_link_id` (FK added in 0021), `unique (id, forum_id)`.
- [x] Column-level `UPDATE` grant on `members`; `revoke update` for `authenticated`.
- [x] `members_guard_identity()` BEFORE UPDATE trigger: refuses changes to `id, forum_id, is_admin, email, status` unless running as the function owner.
- [x] `current_member_forum()` → active member of an active forum only; `current_member_forum_any()`.
- [x] `admin_update_member(member_id, patch)`, `remove_member(member_id)`, `restore_member(member_id)` RPCs (same-forum admin; last-admin / self guards).
- [x] `forums.status` column (needed by `current_member_forum()`), default `active`.

### 1b `0018_isolation_fks_policies.sql` — done
- [x] `forum_id` on `meeting_rounds`, `attendees`, `agenda_items` (backfill from `meetings`; sync trigger).
- [x] `unique (id, forum_id)` on `meetings`, `photos`, `photo_albums`, `parking_lot_items`.
- [x] Composite FKs listed in spec §4.2; `order_member_ids` validation trigger.
- [x] `has_role()` forum-scoped.
- [x] `with check` on every self-write policy; privileged inserts require in-forum submitter + meeting.

### 1c `0019_isolation_functions_realtime.sql` — done
- [x] SECURITY DEFINER hygiene on every function (search_path, revoke public/anon, auth.uid() guard).
- [x] `create_notification` hardening (in-forum recipient, kind allowlist, relative link, server-derived actor).
- [x] `replica identity default` on meetings, meeting_rounds, attendees, notifications.

### 1d App — done
- [x] `src/lib/admin/actions.ts`: member edits → `admin_update_member`; Remove/Restore actions + UI on Admin → Members.
- [x] `src/lib/auth/roles.ts`: `getMyRoles(me)`; replace the twelve ad-hoc lookups.
- [x] Notifications bell: only relative links.
- [x] `recordPhoto` path assertion; signed URL TTL 10 min.
- [x] Auth callback: remove query-param logging.
- [x] Every server action that takes a client UUID (meeting, submitter, photo, item): `.eq("forum_id", me.forum_id)` guard (belt to the DB's braces).

### 1e Verification
- [x] `scripts/isolation-test.mjs` + `npm run test:isolation` (fixtures via service role for now); assertions §12.1–9.
- [x] Adversarial review workflow (SQL + app); fix; commit.
- [ ] **Run the suite green** against the test project (blocked on `.env.test.local`).

## Phase 2 — Forum settings, de-hardcoding, AI caps — built, local commit

- [x] `0020_forum_settings.sql`: `forums.timezone`, `forums.created_by`; backfill Cupcake tz; `update_forum_settings(p_name, p_timezone, p_charter)` RPC replacing the charter UPDATE path (`revoke update on forums from authenticated` entirely).
- [x] `getCurrentMember()` returns `me.forum` (React `cache()`d); `/suspended` + `/removed` pages; `(app)` layout calls `requireCurrentMember()`.
- [x] `src/lib/dates.ts` REQUIRES `timezone`; every call site passes `me.forum.timezone`; client components (`qol-history`, `schedule-control`, `edit-meeting-dialog`) receive `timezone` props. Fixed the edit dialog rendering the datetime-local value in the browser zone (saved as forum zone → shifted meetings for travelling admins).
- [x] Forum-name substitution (sidebar, mobile header, admin blurb, print meta line, email subject + header); product mentions stay.
- [x] Admin → Settings page (`/admin/settings`: name + timezone, native select over `Intl.supportedValuesOf`); charter form → client component + RPC; both return `{ok,error}`.
- [x] `src/lib/ai/limits.ts` + `checkAiBudget` in brain-dump, interview, patterns (silent skip), listening, merge (deterministic fallback), tts (429 → browser voice); `metadata.user_id` hash on every Anthropic call.
- [x] Isolation suite §12.13–12.15 (my_forum_status, update_forum_settings + suspended forum, forum_ai_calls_today).
- [x] Review; commit (local — push after 0017–0020 are applied).

## Phase 3 — Onboarding — live 2026-10-16 (0021 applied, pushed as 388da52)

- [x] `0021_onboarding.sql`: `platform_settings` (`signup_enabled`, default **false**); `forum_invite_links` (+ `(id, forum_id)` unique, creator composite FK); `members.joined_via_link_id` composite FK; `create_forum`, `peek_invite` (the one anon-callable definer), `join_forum`, `create_invite_link`, `revoke_invite_link`, `signup_enabled()`, `is_valid_forum_timezone()`; drops `member_invites` + `handle_new_user` (refuses while invites are pending).
- [x] Proxy allowlist: `/signup`, `/join/*`; `requireCurrentMember()`: membership-less → `/onboarding`; login form + auth callback route by `my_forum_status` (no more "not invited" sign-out).
- [x] Pages: `/signup`, `/onboarding` (create / paste a link), `/join/[token]` (peek → inline sign-in → join), `/admin/invite` (current link, copy, revoke, new link with expiry + cap, joiners, past links); Admin → Members loses the email-invite UI; `src/lib/forums/actions.ts` wrappers (`{ok,error}`, §11 code → copy); first-run checklist card on the dashboard (admins, while < 2 members / no meeting / no charter).
- [x] **Deviation from spec §6/§10 (deliberate):** the signup switch is `platform_settings.signup_enabled` in the database, not an env var — enforced by `create_forum()` itself and read by the pages via `signup_enabled()`. One switch, no redeploy: `update platform_settings set value = 'true' where key = 'signup_enabled';`
- [x] Isolation suite: fixtures go through `create_forum` → `create_invite_link` → `join_forum`; assertions §12.10 (one forum per account incl. removed members; peek leaks only the name; links unreadable/uneditable by anyone but the forum's admins; expired / exhausted / revoked; founder = admin + moderator + technology; switch enforced and unflippable; allowlist gone); §12.12 allow-lists `peek_invite`.
- [x] Browser smoke test against the test project; review; commit. Resend SMTP configured 2026-10-16; **the sign-up switch is still off** — the owner flips it from `/platform`.

## Phase 4 — Platform layer — live 2026-10-16 (0022 applied, pushed as 6ad0f2c)

- [x] `0022_platform.sql`: `platform_admins` (seeded with the owner, no policies, unreadable from a session), `is_platform_admin()`, `platform_forum_stats()` (forum-level aggregates + founder name/email only), `platform_set_forum_status()`, and `platform_set_signup_enabled()` so the sign-up switch can be flipped from the page.
- [x] `/platform` (404 unless operator): sign-up switch + forum table (status, founder, members/admins, meetings, next meeting, AI calls 30d, last activity, created, Pause/Reactivate — never for the operator's own forum); "Platform" in the nav only for operators.
- [x] Suite assertions §12.11 (operators only; nobody can self-promote; exact column set; numbers; pause ends access and kills the invite link; reactivate; switch). Review; commit.

## Owner checklist (per phase)

**Ordering rule for every phase: run the phase's migrations in the SQL editor BEFORE the matching code is pushed to `main`** (Vercel deploys on push, and the new code reads columns/RPCs the migrations create — deploying first would break member lists and rounds until the SQL is run). Phase commits therefore stay local until the migrations are confirmed applied.

0. Run catalog queries → share output.
1. Run 0016 (if any), 0017, 0018, 0019 in order → say so → code is pushed → confirm Admin → Members still edits/removes, a round can be started, charter saves, photos upload.
2. Run 0020 → confirm meeting times unchanged (Vancouver).
3. Run 0021 (it refuses while email invites are pending — revoke them in Admin → Members first) → code is pushed → configure Resend custom SMTP in Supabase Auth → open signups with one line in the SQL editor: `update platform_settings set value = 'true' where key = 'signup_enabled';` (nothing reads an env var for this).
4. Run 0022 → open `/platform`.
