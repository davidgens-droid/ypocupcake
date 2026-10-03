-- Cupcake — unreviewed 'captured' parking-lot items are for the moderator's
-- eyes only until reviewed.
--
-- Live capture (0013), quick-jot and listening-mode suggestions all land in
-- the 'captured' holding status, and listening-mode rows carry an AI
-- paraphrase of what a member said in their update. The forum-wide SELECT
-- policy from 0002 had no status restriction, so any forum member could read
-- those rows through the API before the moderator had kept, edited or
-- deleted them. Members now see captured rows only once they're parked;
-- privileged roles (czar / moderator / assistant moderator / admin) see them
-- throughout.
--
-- Idempotent: safe to re-run.

drop policy if exists parking_lot_forum_read on parking_lot_items;
create policy parking_lot_forum_read on parking_lot_items
  for select using (
    forum_id = current_member_forum()
    and (
      status <> 'captured'
      or has_role('czar')
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
