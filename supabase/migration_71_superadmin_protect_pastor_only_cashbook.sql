-- V71: (A) Only a Super Admin can create, change or remove Super Admin accounts.
--      (B) The Cashbook and Reconciliation are private to the Pastor.
-- Run once in the Supabase SQL Editor for EACH church (DT and TT). Safe to run more than once. Take a backup first.
--
-- BEFORE YOU RUN IT: make sure at least one user has the Pastor role (Users > Create user, role Pastor).
-- After this, nobody else (not Admin, not Super Admin, not Finance, not Secretary) can read or change those two tables.

-- =====================================================================================================
-- A. Super Admin protection
-- =====================================================================================================
-- A1. Same guard as migration 56, installed again so every church has it (churches built from the one-file
--     setup script never received it). Only a Super Admin can grant or remove the Super Admin, Pastor and
--     Finance Reviewer roles, and nobody can change their own role. It holds even if the API is called directly.
create or replace function public.protect_sensitive_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  -- No signed-in user: SQL editor, Edge Functions using the service key, the sign-up trigger.
  if auth.uid() is null then return new; end if;
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    if new.role in ('super_admin','pastor','finance_reviewer') and actor_role is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can assign the Super Admin, Pastor or Finance Reviewer role.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role.' using errcode = '42501';
    end if;
    if (new.role in ('super_admin','pastor','finance_reviewer') or old.role in ('super_admin','pastor','finance_reviewer'))
       and actor_role is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can grant, change or remove the Super Admin, Pastor or Finance Reviewer role.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_sensitive_roles() from public, anon, authenticated;

drop trigger if exists protect_sensitive_roles on public.profiles;
create trigger protect_sensitive_roles
  before insert or update of role on public.profiles
  for each row execute function public.protect_sensitive_roles();

-- A2. A Super Admin account cannot be edited or deleted by anyone except a Super Admin (any column, not only the role).
create or replace function public.protect_super_admin_rows() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  if auth.uid() is null then                       -- SQL editor / Edge Functions using the service key
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select role into actor_role from public.profiles where id = auth.uid();
  if old.role = 'super_admin' and actor_role is distinct from 'super_admin' then
    raise exception 'Super Admin accounts can only be changed or removed by a Super Admin.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.protect_super_admin_rows() from public, anon, authenticated;

drop trigger if exists protect_super_admin_rows on public.profiles;
create trigger protect_super_admin_rows
  before update or delete on public.profiles
  for each row execute function public.protect_super_admin_rows();

-- =====================================================================================================
-- B. Cashbook and Reconciliation: Pastor only
-- =====================================================================================================
-- B1. Postgres combines policies with OR, so every existing policy on the two tables is removed first
--     (this also removes the migration-56 "no_review_roles" blocks, which would otherwise stop the Pastor saving).
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('cashbook_entries', 'finance_reconciliations')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cashbook_entries', 'finance_reconciliations'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- B2. Only a signed-in user whose role is exactly 'pastor' can read, add, edit or delete.
do $$
declare
  isp text := $c$(select role from public.profiles where id = auth.uid()) = 'pastor'$c$;
  t text;
begin
  foreach t in array array['cashbook_entries', 'finance_reconciliations'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select_pastor', t, isp);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert_pastor', t, isp);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update_pastor', t, isp, isp);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete_pastor', t, isp);
  end loop;
end $$;

-- B3. The audit log must not reveal these records to anyone but the Pastor either
--     (this replaces the migration-63 rule so it covers all four Pastor-only tables).
drop policy if exists audit_hide_pastor_only on public.audit_log;
create policy audit_hide_pastor_only on public.audit_log
  as restrictive for select to authenticated
  using (
    table_name not in ('prayer_requests', 'pastoral_cases', 'cashbook_entries', 'finance_reconciliations')
    or (select role from public.profiles where id = auth.uid()) = 'pastor'
  );

-- B4. Keep the Role Permissions screen honest.
update public.app_permissions
set description = description || ' (Pastor role only)'
where permission_key in ('finance_reconciliation.view', 'finance_reconciliation.manage')
  and description not like '%Pastor role only%';
