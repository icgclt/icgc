-- V43: the "must change temporary password" flag moves from user_metadata (which any signed-in
-- user can rewrite through the Auth API) to app_metadata (writable only with the service-role key).

-- 1. Carry over members who still have a pending forced change.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb
where raw_user_meta_data->>'must_change_password' = 'true';

-- 2. The app calls this right after the member sets a new password.
create or replace function public.clear_must_change_password()
returns void
language sql
security definer
set search_path = public, auth
as $$
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'must_change_password'
  where id = auth.uid();
$$;

revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;
