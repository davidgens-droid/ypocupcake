-- Cupcake — live parking-lot capture during meetings + post-meeting review.
--
-- During a running meeting, privileged roles can jot a parking-lot item for the
-- person presenting. Those land in a holding status ('captured') tied to the
-- meeting, and are reconciled afterward (delete / park / merge) on a dedicated
-- review screen.

-- New holding status. (Safe in a transaction on PG12+; not referenced below.)
alter type parking_lot_status add value if not exists 'captured';

-- Which meeting's live-capture created this item (null for normal items).
alter table parking_lot_items
  add column if not exists captured_meeting_id uuid
    references meetings(id) on delete set null;

create index if not exists parking_lot_captured_idx
  on parking_lot_items(captured_meeting_id);

-- Privileged roles can hard-delete items — needed to discard captured items
-- (and remove the source item after a merge) in the post-meeting review.
-- Mirrors parking_lot_privileged_manage (0011).
drop policy if exists parking_lot_privileged_delete on parking_lot_items;
create policy parking_lot_privileged_delete on parking_lot_items
  for delete using (
    forum_id = current_member_forum()
    and (
      has_role('czar')
      or has_role('moderator')
      or has_role('assistant_moderator')
      or exists (
        select 1 from members m
        where m.id = auth.uid()
          and m.is_admin = true
          and m.forum_id = parking_lot_items.forum_id
      )
    )
  );
