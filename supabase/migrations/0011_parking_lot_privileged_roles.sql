-- Cupcake — extend parking-lot privileges
-- The original 0002 policy only let Czars insert/manage parking-lot items
-- on behalf of others. Moderators, Assistant Moderators, and admins all
-- have legitimate reasons to do this too (e.g. capturing a topic raised
-- verbally during a meeting). Replace with policies that cover all four.

drop policy if exists parking_lot_czar_insert on parking_lot_items;
drop policy if exists parking_lot_czar_manage on parking_lot_items;

create policy parking_lot_privileged_insert on parking_lot_items
  for insert with check (
    forum_id = current_member_forum()
    and added_by_member_id = auth.uid()
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

create policy parking_lot_privileged_manage on parking_lot_items
  for update using (
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
