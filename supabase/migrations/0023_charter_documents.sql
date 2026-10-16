-- Cupcake — the forum charter / norms as an uploaded document (PDF, Word,
-- text or image), alongside or instead of the typed text.
--
-- * Private storage bucket 'charters' (20 MB, allow-listed types). Objects
--   live at <forum_id>/<uuid>.<ext>. Members of the forum may read; only the
--   forum's active admins may add or delete.
-- * set_charter_document(p_document jsonb): records {path, name, size, type}
--   under forums.settings.charter_document (null removes it). The path must
--   be under the caller's own forum AND name an object that really exists.
--
-- Idempotent and re-runnable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'charters', 'charters', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: active members of the forum the object belongs to. (Compared as
-- text so a malformed first segment can never raise a cast error.)
drop policy if exists "charters_read_forum" on storage.objects;
create policy "charters_read_forum"
on storage.objects for select
to authenticated
using (
  bucket_id = 'charters'
  and (storage.foldername(name))[1] = current_member_forum()::text
);

-- Write / delete: the forum's active admins, under the forum's own prefix.
drop policy if exists "charters_admin_insert" on storage.objects;
create policy "charters_admin_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'charters'
  and (storage.foldername(name))[1] = current_member_forum()::text
  and exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.is_admin = true and m.status = 'active'
  )
);

drop policy if exists "charters_admin_delete" on storage.objects;
create policy "charters_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'charters'
  and (storage.foldername(name))[1] = current_member_forum()::text
  and exists (
    select 1 from public.members m
    where m.id = auth.uid() and m.is_admin = true and m.status = 'active'
  )
);

create or replace function set_charter_document(p_document jsonb) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_forum uuid := assert_forum_admin();
  v_path text;
  v_name text;
  v_type text;
  v_size bigint;
  v_doc jsonb;
begin
  -- null = remove the document (the text charter, if any, is untouched).
  if p_document is null or jsonb_typeof(p_document) = 'null' then
    update forums
    set settings = (coalesce(settings, '{}'::jsonb) - 'charter_document')
      || jsonb_build_object('charter_updated_at', now(), 'charter_updated_by', auth.uid())
    where id = v_forum;
    return;
  end if;

  if jsonb_typeof(p_document) <> 'object' then
    raise exception 'invalid_document';
  end if;
  v_path := p_document ->> 'path';
  v_name := p_document ->> 'name';
  v_type := p_document ->> 'type';
  begin
    v_size := (p_document ->> 'size')::bigint;
  exception when others then
    raise exception 'invalid_document';
  end;
  if v_path is null or v_path not like v_forum::text || '/%' or v_path like '%..%' then
    raise exception 'invalid_document';
  end if;
  if v_name is null or length(trim(v_name)) < 1 or length(v_name) > 200 then
    raise exception 'invalid_document';
  end if;
  if v_size is null or v_size < 1 or v_size > 20971520 then
    raise exception 'invalid_document';
  end if;
  if v_type is null or v_type not in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg'
  ) then
    raise exception 'invalid_document';
  end if;
  -- The record must point at a real upload, never at a path that doesn't exist.
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'charters' and o.name = v_path
  ) then
    raise exception 'document_not_found';
  end if;

  v_doc := jsonb_build_object(
    'path', v_path,
    'name', trim(v_name),
    'size', v_size,
    'type', v_type,
    'uploaded_at', now(),
    'uploaded_by', auth.uid()
  );
  update forums
  set settings = coalesce(settings, '{}'::jsonb)
    || jsonb_build_object(
         'charter_document', v_doc,
         'charter_updated_at', now(),
         'charter_updated_by', auth.uid()
       )
  where id = v_forum;
end;
$$;

revoke execute on function set_charter_document(jsonb) from public, anon;
grant execute on function set_charter_document(jsonb) to authenticated;
