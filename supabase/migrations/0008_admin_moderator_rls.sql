-- Cupcake — let admins also write to moderator-gated tables
-- The original 0002 policies for attendees, agenda_items, and meeting_rounds
-- only allowed members holding the moderator/assistant_moderator role.
-- An admin who hasn't yet been assigned the moderator role for the year
-- couldn't run a meeting. Server-side `ensureMod()` already permits admins,
-- but the RLS layer was blocking the writes. Replace with policies that mirror
-- meetings_moderator_write (moderator OR asst-moderator OR admin).

-- ──────────────────────────────────────────────────────────────────────────
-- attendees
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists attendees_moderator_write on attendees;
create policy attendees_moderator_write on attendees
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid() and m.is_admin = true
          and m.forum_id = current_member_forum()
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- agenda_items
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists agenda_moderator_write on agenda_items;
create policy agenda_moderator_write on agenda_items
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid() and m.is_admin = true
          and m.forum_id = current_member_forum()
      )
    )
  )
  with check (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid() and m.is_admin = true
          and m.forum_id = current_member_forum()
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- meeting_rounds
-- ──────────────────────────────────────────────────────────────────────────
drop policy if exists meeting_rounds_moderator_write on meeting_rounds;
create policy meeting_rounds_moderator_write on meeting_rounds
  for all using (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid() and m.is_admin = true
          and m.forum_id = current_member_forum()
      )
    )
  )
  with check (
    meeting_id in (select id from meetings where forum_id = current_member_forum())
    and (
      has_role('moderator') or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid() and m.is_admin = true
          and m.forum_id = current_member_forum()
      )
    )
  );
