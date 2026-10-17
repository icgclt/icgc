-- Migration 63: Prayer Requests and Pastoral Care are private to the Pastor role.
--
-- Before: Admin, Secretary, Finance and Viewer roles could read these two tables (and Admin/Secretary could edit).
-- After:  only a signed-in user whose role is exactly 'pastor' can read, add, edit or delete them.
--         Members can still send their own prayer requests and read their own, from the member portal.
--
-- Postgres policies are combined with OR, so adding a Pastor policy is not enough: the old policies must be
-- removed. This script does both. It is safe to run more than once.
-- Take a backup first. Super Admin and Admin lose access to these two tables by design.

-- 1. Remove every existing policy on the two tables, except the members' own prayer-request policies.
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('prayer_requests', 'pastoral_cases')
      and policyname not in ('prayer_member_insert', 'prayer_member_select')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.prayer_requests enable row level security;
alter table public.pastoral_cases  enable row level security;

-- 2. Pastor-only policies.
do $$
declare
  isp text := $c$(select role from public.profiles where id = auth.uid()) = 'pastor'$c$;
  t text;
begin
  foreach t in array array['prayer_requests', 'pastoral_cases'] loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)',
                   t || '_select_pastor', t, isp);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   t || '_insert_pastor', t, isp);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   t || '_update_pastor', t, isp, isp);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                   t || '_delete_pastor', t, isp);
  end loop;
end $$;

-- 3. The audit log must not reveal these records to anyone but the Pastor either.
drop policy if exists audit_hide_pastor_only on public.audit_log;
create policy audit_hide_pastor_only on public.audit_log
  as restrictive for select to authenticated
  using (
    table_name not in ('prayer_requests', 'pastoral_cases')
    or (select role from public.profiles where id = auth.uid()) = 'pastor'
  );

-- 4. Keep the Role Permissions screen honest: these permissions only work for the Pastor role.
update public.app_permissions
set description = description || ' (Pastor role only)'
where permission_key in ('prayer_requests.view', 'prayer_requests.manage', 'pastoral_cases.view', 'pastoral_cases.manage')
  and description not like '%Pastor role only%';

update public.role_permissions rp
set enabled = false
from public.app_permissions ap
where ap.id = rp.permission_id
  and ap.permission_key in ('prayer_requests.view', 'prayer_requests.manage', 'pastoral_cases.view', 'pastoral_cases.manage')
  and rp.role not in ('pastor', 'member');

insert into public.role_permissions (role, permission_id, enabled)
select 'pastor', ap.id, true
from public.app_permissions ap
where ap.permission_key in ('prayer_requests.view', 'prayer_requests.manage', 'pastoral_cases.view', 'pastoral_cases.manage')
on conflict (role, permission_id) do update set enabled = true;
