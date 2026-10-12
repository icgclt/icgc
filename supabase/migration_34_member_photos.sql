-- Lightweight member passport photos for Supabase Free.
-- Photos live in private Supabase Storage; public.members stores only the object path.

alter table public.members add column if not exists photo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-photos',
  'member-photos',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

-- Members/portal-facing staff can view photos; write/delete follows member write/delete access.
drop policy if exists member_photos_select on storage.objects;
create policy member_photos_select on storage.objects
for select to authenticated
using (
  bucket_id = 'member-photos'
  and public.app_role() in ('admin','finance','secretary','viewer')
);

drop policy if exists member_photos_insert on storage.objects;
create policy member_photos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'member-photos'
  and public.app_role() in ('admin','secretary')
);

drop policy if exists member_photos_update on storage.objects;
create policy member_photos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'member-photos'
  and public.app_role() in ('admin','secretary')
)
with check (
  bucket_id = 'member-photos'
  and public.app_role() in ('admin','secretary')
);

drop policy if exists member_photos_delete on storage.objects;
create policy member_photos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'member-photos'
  and public.app_role() in ('admin')
);
