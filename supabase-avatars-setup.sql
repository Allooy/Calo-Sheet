-- Agent photos: adds the column + a public Storage bucket + policies.
-- Run once in Supabase → SQL Editor.

-- 1) Column that stores the image URL (not the image itself)
alter table public.agents
  add column if not exists avatar_url text;

-- 2) Public bucket to hold the actual image files
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 3) Storage policies: anyone can view; only admins can upload/replace/delete.
drop policy if exists "avatars_public_read"   on storage.objects;
drop policy if exists "avatars_admin_insert"  on storage.objects;
drop policy if exists "avatars_admin_update"  on storage.objects;
drop policy if exists "avatars_admin_delete"  on storage.objects;

create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_admin());

create policy "avatars_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and public.is_admin())
  with check (bucket_id = 'avatars' and public.is_admin());

create policy "avatars_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());
