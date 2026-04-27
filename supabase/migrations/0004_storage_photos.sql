-- Cupcake — Storage bucket + policies for the Photo Gallery
--
-- Bucket layout: paths begin with "<forum_id>/<uploader_member_id>/<uuid>.<ext>"
-- so RLS can verify the caller is a forum member and that they only write
-- under their own member id.

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- Read: any authenticated forum member can read photos in their forum prefix.
create policy "photos_read_forum"
on storage.objects for select
to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1]::uuid = (
    select forum_id from public.members where id = auth.uid()
  )
);

-- Insert: uploader can write under <their_forum>/<their_member_id>/...
create policy "photos_insert_self"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1]::uuid = (
    select forum_id from public.members where id = auth.uid()
  )
  and (storage.foldername(name))[2]::uuid = auth.uid()
);

-- Delete: uploader only.
create policy "photos_delete_self"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[2]::uuid = auth.uid()
);
