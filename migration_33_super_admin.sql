-- Super Admin role: unrestricted application/database access.
-- Safe to run on an existing church-management database.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin','admin','finance','secretary','viewer','pending'));

-- Super Admin and legacy admin are both full administrators.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$ select case when role = 'super_admin' then 'admin' else role end from public.profiles where id = auth.uid() $$;

-- Replace the policies with Super Admin-aware policies.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() in ('super_admin','admin'));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.app_role() in ('super_admin','admin'))
  with check (public.app_role() in ('super_admin','admin'));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (public.app_role() in ('super_admin','admin'));

do $$
declare t text;
begin
  foreach t in array array['members','attendance','departments','events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.app_role() in ('super_admin','admin','finance','secretary','viewer'))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.app_role() in ('super_admin','admin','secretary'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.app_role() in ('super_admin','admin','secretary'))
      with check (public.app_role() in ('super_admin','admin','secretary'))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (public.app_role() in ('super_admin','admin'))$p$, t || '_delete', t);
  end loop;
end $$;

drop policy if exists giving_select on public.giving;
create policy giving_select on public.giving for select to authenticated
  using (public.app_role() in ('super_admin','admin','finance'));
drop policy if exists giving_insert on public.giving;
create policy giving_insert on public.giving for insert to authenticated
  with check (public.app_role() in ('super_admin','admin','finance'));
drop policy if exists giving_update on public.giving;
create policy giving_update on public.giving for update to authenticated
  using (public.app_role() in ('super_admin','admin','finance'))
  with check (public.app_role() in ('super_admin','admin','finance'));
drop policy if exists giving_delete on public.giving;
create policy giving_delete on public.giving for delete to authenticated
  using (public.app_role() in ('super_admin','admin'));

-- Existing admin accounts remain fully privileged. New accounts can now be
-- explicitly assigned the super_admin role from the Users screen.
