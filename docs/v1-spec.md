# Cupcake — YPO Forum App, V1 Spec

_Last updated: 2026-04-26_

## 1. Goal

A web app (mobile-friendly PWA) that is the single tool Cupcake forum members use to prep for and run their forum meetings, with year-round collaboration on shared items (parking lot, commitments, photo gallery). Built around the YPO 5% Reflection update format, with member updates strictly private.

## 2. In scope for V1

1. Auth & forum membership
2. Update Builder (private prep, mirrors the YPO Update Form)
3. AI Assistant (per-member, opt-in)
4. Parking Lot (annual presentation backlog, EQ/IQ classified)
5. Commitments (shared, for accountability)
6. Meeting Runner (live mode, randomized round order with hidden order, agenda timer, format-aware Exploration phases, custom agenda items)
7. Forum Admin (calendar, role rotation, member directory)
8. Photo Gallery (forum-shared)

## 3. Deferred to later versions

- Between-meeting "pulse" check-ins
- Spouse/guest read-only mode
- Retreat planner (extended-format meetings)
- Multi-tenant onboarding flow (other forums)
- End-to-end encryption upgrade
- Native mobile apps (PWA covers V1)
- AI photo auto-tagging, video uploads

## 4. User roles

- **Member** — every Cupcake member; full access to own data, shared meeting/parking-lot/commitment/photo views.
- **Moderator** — annual rotating role; same data access as Member, plus meeting-runner controls and the ability to edit/add custom agenda items.
- **Parking Lot Czar** — annual rotating role; can rank/schedule/archive parking lot items, **and can add new parking lot items on behalf of any member** (manually setting `submitter_member_id`). Handles the case where a topic comes up verbally and the czar captures it.
- **Assistant Moderator** — annual rotating role; same data access as Member. Acts as the **default backup moderator** if the active moderator drops connection or steps out, and can take over runner controls without manual handoff.
- **Admin** (David, V1) — manages forum settings, member roster, role assignments. **No access to other members' Update content.**

## 5. Feature specs

### 5.1 Update Builder (private)

Step-by-step wizard, save-as-you-go, mirrors the YPO Update Form one-to-one. Mobile-first, single-question-per-screen flow.

**UX decisions (2026-04-26):**
- Past updates browseable forever (no auto-archive).
- "One sentence only" on Situation: soft warning + visible char counter, not a hard stop.
- "Mark Ready" means "I have something to share" — members can edit at any time, including during the meeting.
- AI brain-dump: voice + text on mobile; text-only on desktop for V1 (voice deferred).

**Screens (in order):**

1. **Forum 5% Reflection — intro card.** Reminders: 3–5 quality words · one sentence · 5/5/90 Rule.
2. **Quality of Life Snapshot.** Four sliders 1–10 (default 5): Physical Health, Mental Health, Financial Health, Friends/Community. Sparkline below each shows the member's last 6 meetings.
3. **Business — Feelings.** 3–5 word chips with autocomplete from feelings vocabulary.
4. **Business — Situation.** Single sentence (200-char soft limit, hard limit 280).
5. **Business — Significance.** Three text inputs labeled "Why? · Why? · Why?"
6. **Family — Feelings / Situation / Significance** (same three screens).
7. **Personal — Feelings / Situation / Significance** (same three screens).
8. **Most important thing coming up.** Text + 3 feeling-word chips.
9. **Energy vampire.** Single-line text.
10. **One goal.** Text + day/week/month picker.
11. **Topic to present.** Text + toggle "Publish to Parking Lot for the group to see." When toggled on, member also picks:
    - EQ or IQ classification
    - Exploration Format from the dependent dropdown (with `(?)` info popovers showing time, description, moderator instructions)
12. **Review & finalize.** Full read-back, edit-any-field, then **Mark Ready** (sets a green dot visible to moderator — content not shared) + Email-to-self / Download PDF actions.

**Privacy enforcement:** RLS policy `updates.member_id = auth.uid()` on SELECT/UPDATE/DELETE. No admin/moderator role bypass.

### 5.2 AI Assistant (V1, per-member)

Lives inside the member's own auth context. Reads only the authenticated member's data.

**Capabilities:**
- **Brain-dump → draft update**: voice or text input ("here's what's been going on…"), AI populates the form fields; member edits before saving.
- **Pattern surfacing on the dashboard**: short cards like "Mental Health has trended down 4 months running" or "Family situations have repeatedly involved [name] — recurring theme worth presenting?"
- **Presentation topic suggestions**: scans the member's own 5% history, proposes parking-lot-worthy topics (member chooses to publish or not).
- **Year-end review**: PDF summary of trends, wins, recurring vampires, goal hit-rate.

**Implementation:** Anthropic API (Claude Sonnet 4.6 default for cost; Opus available for deeper review). Zero data retention enabled. Prompt caching for the system prompt + member history. Server-side calls (member's session only); RLS ensures the call can only fetch its own member data.

### 5.3 Parking Lot

The only opt-in publishing path from private updates to the group.

**UX decisions (2026-04-26):**
- Item withdrawal soft-archives (status `withdrawn`); preserves czar's planning history.
- Czar has full edit rights on any field of any item — no "suggest, member confirms" gate.
- Comments / between-meeting discussion threads on items: deferred to V2.
- `archived` and `presented` items show a "Re-park" action that clones the item back to `parked` and links to prior takeaways.

**Submission paths:**
1. Member self-submission via Update Builder (Step 11 toggle).
2. Member self-submission directly from Parking Lot screen.
3. **Czar adds on behalf** — czar opens "+ New item," picks any member from a dropdown as submitter, fills the rest.

**Fields:**
- `topic` (required)
- `context` (optional, 1 paragraph)
- `urgency`: low / med / high
- `tool_category`: **EQ** or **IQ** (required) — radio buttons with brief inline explanation:
    - *EQ*: Unresolved, emotionally complex questions. Tools invite us to "feel with."
    - *IQ*: Fast paced, on point, crisp. Share relevant experiences & lessons.
- `exploration_format`: dropdown whose options depend on `tool_category` (renamed from "depth wanted")
    - **If EQ:** Four-Step Forum Exploration · Blind Window Feedback · Connection / Self-Discovery
    - **If IQ:** Lightning Round · Brainstorm · Topical / Round Table Discussion · Needs & Leads · Learning Exchange · Internal Expert · External Expert
- Each option has a `(?)` info icon. Hover (desktop) or tap (mobile) opens a popover with: time required, one-paragraph description, moderator instructions — sourced verbatim from the Hesse Partners Forum Tools Moderator Guide 2025.
- `submitter_member_id` (auto-set, or set by czar when adding on behalf)
- Status lifecycle: `parked` → `scheduled` → `presented` → `archived`.

**Tool reference data** lives in a versioned `exploration_formats` table seeded from the moderator guide, so we can update text without code changes.

### 5.4 Commitments (shared)

- Created during or after meetings: "I commit to [text] by [date]."
- Author + text + due date + status (`open` / `done` / `dropped` / `carried-over`) — all visible to the forum.
- At each meeting's check-in, the Meeting Runner surfaces open commitments older than the last meeting and prompts the moderator to ask each member for an update.
- Members can also self-update commitment status anytime.

### 5.5 Meeting Runner

Drives the live meeting flow. Single moderator-driven screen, projectable.

**Flow:**
1. **Pre-meeting lobby.** Roster with green/grey dots showing who's marked Ready. Click "Start Meeting."
2. **Check-in.** Surfaces last meeting's open commitments; moderator clicks through each, member self-reports.
3. **Updates round.** App generates a random order of attending members at round start (Fisher-Yates with `crypto.getRandomValues`). **Members do NOT see the order, do NOT see who's "on deck," and do NOT see when their turn will be.** Each member's own device shows only "Updates round in progress" until the moderator reveals them. Moderator's screen reveals "Up now: [name]" one at a time — only after the previous member finishes. The full order is hidden even from the moderator until each reveal. Per-member timer (configurable, default 5 min) with visible countdown and chime at 1-min and 0. Members present from their own device.
4. **Presentation/Exploration.** Pick a parking lot item (czar's recommendation auto-surfaced). The runner loads the format-specific flow based on the item's `exploration_format`:

    | Format | Default time | Phase structure |
    |---|---|---|
    | Four-Step Forum Exploration | 60 min | Presentation → Clarifying Qs → Experience Sharing (random order) → Member Reflection |
    | Blind Window Feedback | 15 min | Member presents (3) → Member turns back, forum shares (10, random order) → Member rejoins & responds (2) |
    | Connection / Self-Discovery | 15–45 min | Setup → Worksheet/individual → Pair/small group → Whole group share |
    | Lightning Round | 5 min | Question shown → each member <1 min answer (random order) → done |
    | Brainstorm | 10–15 min | Frame question → 1 min silent ideation → one-idea-per-member round (random order) → open popcorn |
    | Topical / Round Table | 20–30 min | Moderator framing → moderated discussion (timer visible) → each member's take-home |
    | Needs & Leads | 8–10 min | Each member: needs → each member: leads (random order) |
    | Learning Exchange | 20–60 min | Member framing → each member's takeaway/question → optional scribe notes |
    | Internal Expert | 30 min | Member presents (10–15) → Q&A (10–20) → take-home round |
    | External Expert | ~30 min | Speaker intro → 15-min talk → Q&A → debrief round |

    Each format screen shows: large countdown timer, current phase + brief instructions, "next phase" button, pause/extend controls. Random-order rounds use the same hidden-order pattern as the Updates round.

5. **Parking lot review.** Quick scan, capture new items raised in this meeting.
6. **Commitments capture.** Each member states a commitment (random order, hidden); moderator types into the shared list.
7. **Wrap.** Mark meeting closed; commitments persist, parking lot items resorted, member dashboards refresh trends.

**Custom agenda items:**
- Moderator has an always-visible "+ Add agenda item" button before and during the meeting.
- Custom item fields: `title`, `time_allocation`, `notes`, `position` (drag to reorder).
- Custom items can also be inserted mid-meeting; timer pool adjusts.
- Moderator can edit/skip/extend any item — built-in or custom — at any time.

**Time controls:** moderator can pause, skip, +5 min, -5 min on any timer.

**Runner UX decisions (2026-04-26):**
- **Presenter / Cast mode** — moderator can toggle a stripped view (no controls, no spoilers) intended for casting to a TV or projector while the moderator keeps controls on their own device.
- **Connection drop / handoff** — meeting state is server-authoritative. If the active moderator drops, any member with the **Assistant Moderator** role can re-enter and take over the runner without manual handoff. The active moderator can also explicitly hand off via the ⋮ menu.
- **Random-order reproducibility** — round order is generated server-side at round start and stored on the `meeting_rounds` row. Clients only render what's been "revealed" by the active moderator. Refreshes are safe; turn order never reshuffles mid-round.
- **Scribe** — for Brainstorm / Topical / Learning Exchange / etc., the meeting host is the default scribe; moderator can reassign at any time.
- **Closing round** — optional, off by default; moderator opts in at the Wrap step.

### 5.6 Forum Admin

- Member roster (name, email, photo, family details, birthdays/anniversaries — plaintext, forum-visible)
- Annual roles assignment (Moderator, Parking Lot Czar, Host rotation)
- Meeting calendar with location/host
- Forum charter / shared values doc (rich text, forum-visible)

### 5.7 Photo Gallery

A forum-shared section where members upload photos to share with the group — family moments, trips, milestones, photos from past meetings.

**Features:**
- Grid view, newest first; infinite scroll
- Upload from web or mobile (multi-select); EXIF stripped on upload for privacy
- Optional caption + date + tags
- React with emoji + comment thread per photo
- Filter by uploader, tag, or date range
- Albums — members can group photos (e.g., "2026 Banff retreat")
- Forum-wide visibility; uploader can delete their own; no admin override (consistent with privacy posture)

**Out of scope V1:** AI auto-tagging, face recognition, video.

## 6. Data model

```
forums                (id, name, created_at, settings_json)
members               (id, forum_id, email, name, photo_url, family_json, birthday, role)
meetings              (id, forum_id, scheduled_at, host_member_id, location, status, charter_snapshot)
attendees             (meeting_id, member_id, attending_bool, ready_bool, ready_at)
roles                 (id, forum_id, member_id, role_type, year)
                      -- role_type: 'moderator' | 'assistant_moderator' | 'czar' | 'host'

updates               (id, member_id, meeting_id, content_json, completed_at, ready_bool)
                      -- content_json holds all form fields; member-private via RLS

parking_lot_items     (id, forum_id, submitter_member_id, added_by_member_id,
                       topic, context, urgency, tool_category, exploration_format,
                       status, scheduled_meeting_id, presented_at, takeaways)

exploration_formats   (code primary key, category, display_name, default_minutes,
                       short_description, moderator_instructions, source_attribution)
                      -- seed table from Hesse Partners Forum Tools Moderator Guide 2025

agenda_items          (id, meeting_id, kind, parking_lot_item_id?, title, notes,
                       time_allocation_min, position, status)
                      -- kind: 'updates' | 'check_in' | 'parking_lot_item' | 'commitments' | 'custom'

meeting_rounds        (id, meeting_id, round_type, order_json, current_index,
                       started_at, ended_at)
                      -- round_type: 'updates' | 'experience_sharing' | 'commitments' | etc.

commitments           (id, forum_id, member_id, meeting_id, text, due_date, status, updated_at)

photos                (id, forum_id, uploader_member_id, storage_path, caption,
                       taken_at, uploaded_at, album_id?, tags text[])
photo_albums          (id, forum_id, name, cover_photo_id, created_by)
photo_reactions       (photo_id, member_id, emoji, created_at)
photo_comments        (id, photo_id, member_id, body, created_at)

ai_interactions       (id, member_id, kind, prompt_hash, created_at)
                      -- audit log only, no content stored long-term
```

## 7. RLS policies (V1)

```sql
-- All forum-scoped tables
CREATE POLICY forum_member_read ON <table>
  FOR SELECT USING (forum_id IN (SELECT forum_id FROM members WHERE id = auth.uid()));

-- updates: member-private, no forum-wide read
CREATE POLICY own_updates_only ON updates
  FOR ALL USING (member_id = auth.uid());

-- commitments: forum-visible read, author-only write
CREATE POLICY commitments_forum_read ON commitments
  FOR SELECT USING (forum_id = current_member_forum());
CREATE POLICY commitments_author_write ON commitments
  FOR INSERT, UPDATE USING (member_id = auth.uid());

-- parking_lot_items
CREATE POLICY parking_lot_read ON parking_lot_items
  FOR SELECT USING (forum_id = current_member_forum());
CREATE POLICY parking_lot_author_edit ON parking_lot_items
  FOR UPDATE USING (submitter_member_id = auth.uid() AND status = 'parked');
CREATE POLICY parking_lot_czar_manage ON parking_lot_items
  FOR UPDATE USING (auth.uid() IN (SELECT member_id FROM roles
                                    WHERE role_type='czar' AND forum_id = parking_lot_items.forum_id));
CREATE POLICY parking_lot_czar_insert ON parking_lot_items
  FOR INSERT WITH CHECK (auth.uid() IN (SELECT member_id FROM roles
                                          WHERE role_type='czar' AND forum_id = parking_lot_items.forum_id));

-- exploration_formats: world-readable to authenticated forum members
CREATE POLICY formats_read ON exploration_formats FOR SELECT USING (true);

-- agenda_items: forum-visible read; moderator-only write
CREATE POLICY agenda_read ON agenda_items
  FOR SELECT USING (meeting_id IN (SELECT id FROM meetings WHERE forum_id = current_member_forum()));
CREATE POLICY agenda_moderator_write ON agenda_items
  FOR ALL USING (auth.uid() IN (SELECT member_id FROM roles
                                 WHERE role_type IN ('moderator','assistant_moderator')
                                   AND forum_id = current_member_forum()));

-- photos: forum-visible read; uploader-only write/delete
CREATE POLICY photos_read ON photos
  FOR SELECT USING (forum_id = current_member_forum());
CREATE POLICY photos_uploader_write ON photos
  FOR INSERT, UPDATE, DELETE USING (uploader_member_id = auth.uid());
-- same pattern for photo_albums, photo_reactions, photo_comments
```

Admin role does **not** get a bypass on the `updates` table. The Postgres `service_role` (used by AI calls) is gated by app-layer code that always sets `auth.uid()` to the calling member.

## 8. Tech stack

- **Framework:** Next.js 15 (App Router) + TypeScript
- **UI:** Tailwind + shadcn/ui; Framer Motion for round-flip animations
- **Auth:** Clerk (magic link + passkey) — recommended for V1
- **DB:** Supabase Postgres (RLS-native, easy auth integration)
- **Storage:** Supabase Storage for member photos and gallery uploads
- **AI:** Anthropic API (Claude Sonnet 4.6 + Opus on demand) with prompt caching, zero retention
- **PDF export:** `@react-pdf/renderer` server-side
- **Email:** Resend
- **Hosting:** Vercel
- **Branding:** "Cupcake" — forum name in copy. App marketing name TBD.

### 5.8 Notifications (V1)

- **Channels:** in-app + email only. No push notifications in V1.
- **Triggers:**
    - Czar adds a parking-lot item on your behalf
    - Your commitment is overdue
    - A meeting reminder 24h and 1h before start
    - Someone reacts/comments on a photo you uploaded
    - AI surfaces a high-confidence pattern card for you (member-only, never to others)
- Per-member preferences in Settings → Notifications: per-trigger on/off + email digest cadence (instant / daily / weekly / off).

### 5.9 AI cost guardrails (V1)

- Per-member monthly soft cap: **50 brain-dump generations** + **unlimited pattern/dashboard reads** + **5 conversational AI sessions**.
- Soft warning at 80% of cap; hard stop at 100% with "Try again next month or contact admin" message.
- Admin sees forum-level usage in Forum Admin → AI usage tab.
- Defaults tunable in `forums.settings_json`.

### 5.10 Account deletion behavior

- Member can self-delete from Settings → Privacy & Data with confirmation.
- On deletion:
    - Updates, AI conversations, private notes — **hard-deleted** (member-private, no shared dependency).
    - Parking-lot submissions — **anonymized**: `submitter_member_id` swapped to a forum-scoped "Former member" placeholder; topics and takeaways preserved for forum history.
    - Commitments — anonymized similarly; status preserved for the forum's accountability log.
    - Photos — uploader can choose at delete time: hard-delete all, or transfer ownership to "Former member" (preserved in gallery).
    - Comments/reactions on others' photos — anonymized to "Former member."

## 9. Non-functional

- **Mobile:** PWA, installable; all core flows usable on iPhone-sized screens
- **Offline:** Update Builder must work offline (drafts saved to IndexedDB, synced on reconnect)
- **Performance:** Time-to-interactive < 2s on 4G mobile; meeting runner timer must not drift
- **Accessibility:** WCAG AA; large-tap targets for live-meeting screens
- **Auditability:** every commitment status change and parking lot transition logged

## 10. Open decisions before build

1. **Hosting region** — Canada (Toronto) for data residency given Merchant Growth context? Worth confirming.
2. **AI billing** — pass-through cost to forum, or absorbed? Estimate ~$5–15/member/month.
3. **App name** — is the product literally called "Cupcake," or is Cupcake just the configured forum within a generically-named app?
4. **Photo handling on Updates** — allow per-update photo uploads in the Update Builder (separate from Photo Gallery), or skip for V1?
