-- =====================================================================================
-- ICGC Dominion Temple setup - PART 9 of 10  (parts 8-10 added to bring Dominion level with Testimony Temple)
-- Run the parts IN ORDER, each in its own new query, AFTER parts 1-7 (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_55_finance_status_and_cashbook.sql
-- V55: two things the newer app needs that earlier migrations do not provide.
-- Safe to run more than once, and safe on a database that already has these. Run AFTER migration_54.
--
-- 1) Weekly reports: allow the workflow statuses used by migrations 52-54 and the app.
--    The original table only allowed Draft / Submitted / Checked / Approved, so Reopen / Return / Reject
--    would fail with a "violates check constraint" error. Existing rows keep their current status.
-- 2) Cashbook: create the cashbook_entries table the Cashbook page saves to (opening balances).
--    No earlier migration creates this table. This definition was written from how the app uses it.
--    If the table already exists in your database it is left completely untouched (columns, policies, triggers).

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.finance_weekly_reports'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.finance_weekly_reports drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.finance_weekly_reports
  add constraint finance_weekly_reports_status_check
  check (status in ('Draft','Submitted','Checked','Approved','Reopened','Returned','Rejected'));

do $mig$
begin
  if to_regclass('public.cashbook_entries') is not null then
    raise notice 'cashbook_entries already exists - left unchanged.';
    return;
  end if;

  execute $sql$create table public.cashbook_entries (
    id uuid primary key,
    entry_date date not null,
    entry_type text not null,
    description text,
    amount numeric(14,2) not null default 0,
    payee text,
    pv_no text,
    receipt_no text,
    cheque_no text,
    source_type text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )$sql$;
  execute 'create index cashbook_entries_date_idx on public.cashbook_entries(entry_date)';
  execute 'create index cashbook_entries_updated_at_idx on public.cashbook_entries(updated_at)';
  execute 'alter table public.cashbook_entries enable row level security';
  execute $sql$create policy cashbook_entries_select on public.cashbook_entries for select to authenticated
    using (public.app_role() in ('admin','finance','finance_reviewer','secretary','viewer','pastor','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_insert on public.cashbook_entries for insert to authenticated
    with check (public.app_role() in ('admin','finance','secretary','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_update on public.cashbook_entries for update to authenticated
    using (public.app_role() in ('admin','finance','secretary','super_admin'))
    with check (public.app_role() in ('admin','finance','secretary','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_delete on public.cashbook_entries for delete to authenticated
    using (public.app_role() in ('admin','super_admin'))$sql$;
  execute 'create trigger cashbook_entries_set_updated_at before update on public.cashbook_entries for each row execute function public.set_updated_at()';
  execute 'create trigger cashbook_entries_audit after insert or update or delete on public.cashbook_entries for each row execute function public.audit_row()';
end
$mig$;

-- >>> FILE: migration_55_cashbook_entries.sql
-- V55: the Cashbook table. The app has always read and written public.cashbook_entries,
-- but no earlier SQL file created it. Safe to run on a database that already has the table.

create table if not exists public.cashbook_entries (
  id uuid primary key,
  entry_date date not null,
  entry_type text not null check (entry_type in ('Opening','Receipt','Payment')),
  description text not null default '',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  payee text,
  pv_no text,
  receipt_no text,
  cheque_no text,
  source_type text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table was created by hand earlier, make sure every column the app uses is there.
alter table public.cashbook_entries add column if not exists entry_date date;
alter table public.cashbook_entries add column if not exists entry_type text;
alter table public.cashbook_entries add column if not exists description text default '';
alter table public.cashbook_entries add column if not exists amount numeric(14,2) default 0;
alter table public.cashbook_entries add column if not exists payee text;
alter table public.cashbook_entries add column if not exists pv_no text;
alter table public.cashbook_entries add column if not exists receipt_no text;
alter table public.cashbook_entries add column if not exists cheque_no text;
alter table public.cashbook_entries add column if not exists source_type text;
alter table public.cashbook_entries add column if not exists source_id text;
alter table public.cashbook_entries add column if not exists created_by uuid references auth.users(id);
alter table public.cashbook_entries add column if not exists created_at timestamptz not null default now();
alter table public.cashbook_entries add column if not exists updated_at timestamptz not null default now();

create index if not exists cashbook_entries_date_idx on public.cashbook_entries(entry_date);
create index if not exists cashbook_entries_updated_at_idx on public.cashbook_entries(updated_at);

-- One opening balance per year, even if two devices save at the same time.
do $$
begin
  create unique index if not exists cashbook_one_opening_per_year
    on public.cashbook_entries ((extract(year from entry_date)::int))
    where entry_type = 'Opening';
exception when others then
  raise notice 'Could not create the one-opening-per-year index (existing duplicate Opening rows?): %', sqlerrm;
end $$;

alter table public.cashbook_entries enable row level security;

drop policy if exists cashbook_entries_select on public.cashbook_entries;
drop policy if exists cashbook_entries_insert on public.cashbook_entries;
drop policy if exists cashbook_entries_update on public.cashbook_entries;
drop policy if exists cashbook_entries_delete on public.cashbook_entries;

create policy cashbook_entries_select on public.cashbook_entries
  for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy cashbook_entries_insert on public.cashbook_entries
  for insert to authenticated with check (public.app_role() in ('admin','finance','secretary'));
create policy cashbook_entries_update on public.cashbook_entries
  for update to authenticated
  using (public.app_role() in ('admin','finance','secretary'))
  with check (public.app_role() in ('admin','finance','secretary'));
create policy cashbook_entries_delete on public.cashbook_entries
  for delete to authenticated using (public.app_role() = 'admin');

drop trigger if exists cashbook_entries_set_updated_at on public.cashbook_entries;
create trigger cashbook_entries_set_updated_at
  before update on public.cashbook_entries
  for each row execute function public.set_updated_at();

-- Money tables belong in the audit log (expenditures is already covered by migration 54).
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists cashbook_entries_audit on public.cashbook_entries;
    create trigger cashbook_entries_audit
      after insert or update or delete on public.cashbook_entries
      for each row execute function public.audit_row();
  end if;
end $$;

-- >>> FILE: migration_56_security_hardening.sql
-- V56: security hardening. Safe to run more than once. Run AFTER migration 54.
--
-- 1) Only a Super Admin can grant or remove the Super Admin, Pastor and Finance Reviewer roles,
--    and nobody can change their own role. This holds even if the API is called directly.
-- 2) The Pastor and Finance Reviewer roles use the 'finance' access template, which would let them write
--    giving, receipts, pledges and other money tables. The workflow triggers only guard the weekly
--    reports and expenditure, so these roles are shut out of every other money table here.
-- 3) The Pastor can read and write pastoral cases and follow-ups, and read prayer requests, as the Pastoral Dashboard expects.
-- 4) clear_test_data() is Super Admin only, and refuses to run once finance records are approved.

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

drop trigger if exists protect_super_admin_role on public.profiles;   -- name used by an earlier draft
drop function if exists public.protect_super_admin_role();
drop trigger if exists protect_sensitive_roles on public.profiles;
create trigger protect_sensitive_roles
  before insert or update of role on public.profiles
  for each row execute function public.protect_sensitive_roles();

-- Pastor and Finance Reviewer: no writes to money tables outside the guarded review workflow.
do $$
declare t text; cmd text; cond text; pname text;
begin
  cond := $c$coalesce((select role from public.profiles where id = auth.uid()), '') not in ('pastor','finance_reviewer')$c$;
  foreach t in array array[
    'giving','pledges','payment_receipts','payment_requests','finance_reconciliations',
    'offering_entries','member_contributions','welfare_transactions',
    'finance_weekly_cash_counts','finance_weekly_momo',
    'finance_weekday_collections','finance_weekday_cash_counts','finance_weekday_momo',
    'cashbook_entries'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    foreach cmd in array array['insert','update','delete'] loop
      pname := 'no_review_roles_' || cmd;
      execute format('drop policy if exists %I on public.%I', pname, t);
      if cmd = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', pname, t, cond);
      elsif cmd = 'update' then
        execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', pname, t, cond, cond);
      else
        execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', pname, t, cond);
      end if;
    end loop;
  end loop;
end $$;

-- The Pastor leads pastoral care. The Pastoral Dashboard lets the Pastor save pastoral cases and follow-ups, and the
-- Pastor reads prayer requests, but the database only allowed admins and secretaries to do so. No delete.
do $$
declare
  isp text := $c$(select role from public.profiles where id = auth.uid()) = 'pastor'$c$;
begin
  -- pastoral_cases: read, add, edit
  drop policy if exists pastoral_cases_select_pastor on public.pastoral_cases;
  drop policy if exists pastoral_cases_insert_pastor on public.pastoral_cases;
  drop policy if exists pastoral_cases_update_pastor on public.pastoral_cases;
  execute format('create policy pastoral_cases_select_pastor on public.pastoral_cases for select to authenticated using (%s)', isp);
  execute format('create policy pastoral_cases_insert_pastor on public.pastoral_cases for insert to authenticated with check (%s)', isp);
  execute format('create policy pastoral_cases_update_pastor on public.pastoral_cases for update to authenticated using (%s) with check (%s)', isp, isp);
  -- follow_ups: add, edit (reading already works)
  drop policy if exists follow_ups_insert_pastor on public.follow_ups;
  drop policy if exists follow_ups_update_pastor on public.follow_ups;
  execute format('create policy follow_ups_insert_pastor on public.follow_ups for insert to authenticated with check (%s)', isp);
  execute format('create policy follow_ups_update_pastor on public.follow_ups for update to authenticated using (%s) with check (%s)', isp, isp);
  -- prayer_requests: read, edit (for example mark as prayed for)
  drop policy if exists prayer_requests_select_pastor on public.prayer_requests;
  drop policy if exists prayer_requests_update_pastor on public.prayer_requests;
  execute format('create policy prayer_requests_select_pastor on public.prayer_requests for select to authenticated using (%s)', isp);
  execute format('create policy prayer_requests_update_pastor on public.prayer_requests for update to authenticated using (%s) with check (%s)', isp, isp);
end $$;

create or replace function public.clear_test_data()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a Super Admin can clear test data.' using errcode = '42501';
  end if;
  -- Once finance records have been approved, the audit trail must be kept. Test data can only be cleared before that.
  begin
    if exists (select 1 from public.finance_weekly_reports where status in ('Approved','Rejected'))
       or exists (select 1 from public.expenditures where status in ('Approved','Rejected')) then
      raise exception 'Test data cannot be cleared after financial records have been approved.' using errcode = '42501';
    end if;
  exception when undefined_table or undefined_column then
    null; -- the finance workflow has not been installed yet, so there is nothing locked
  end;
  update public.profiles set member_id = null where member_id is not null;
  update public.profiles set branch_id = null where branch_id is not null;
  truncate table
    public.abc_class_attendance,
    public.member_group_history,
    public.audit_log,
    public.attendance,
    public.giving,
    public.offering_entries,
    public.member_contributions,
    public.welfare_transactions,
    public.welfare_members,
    public.attendance_headcount,
    public.visitors,
    public.groups,
    public.follow_ups,
    public.prayer_requests,
    public.volunteers,
    public.service_plans,
    public.pastoral_cases,
    public.event_registrations,
    public.announcements,
    public.families,
    public.children,
    public.child_checkins,
    public.department_members,
    public.group_members,
    public.group_attendance,
    public.volunteer_schedules,
    public.pledges,
    public.payment_receipts,
    public.communication_templates,
    public.communication_queue,
    public.finance_reconciliations,
    public.branches,
    public.notification_campaigns,
    public.notification_logs,
    public.payment_requests,
    public.payment_webhook_events,
    public.member_notification_preferences,
    public.members,
    public.departments,
    public.events
  restart identity cascade;
end; $$;
revoke all on function public.clear_test_data() from public, anon;
grant execute on function public.clear_test_data() to authenticated;

-- >>> FILE: migration_57_multi_day_events.sql
-- V57: multi-day programmes. The Events screen saves recurrence = 'multi_day' and a duration_days value,
-- but the database only allowed 'none' and 'weekly' and had no duration_days column, so every save failed.

alter table public.events add column if not exists duration_days integer not null default 1;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recurrence = any%'
  loop
    execute format('alter table public.events drop constraint %I', r.conname);
  end loop;
  alter table public.events drop constraint if exists events_recurrence_check;
  alter table public.events add constraint events_recurrence_check check (recurrence in ('none','weekly','multi_day'));
  alter table public.events drop constraint if exists events_duration_days_check;
  alter table public.events add constraint events_duration_days_check check (duration_days between 1 and 60);
end $$;

-- >>> FILE: migration_58_expenditure_permissions.sql
-- V58: Expenditure gets its own View / Manage checkboxes under Role Permissions.
-- Existing access is copied across, so nobody loses the Expenditure screen:
--   whoever has Finance > View gets Expenditure > View, and whoever has Finance > Manage gets Expenditure > Manage.
-- Approving, returning and rejecting stay under the separate Finance Reviewer permission.

insert into public.app_permissions (permission_key, module, action, label, description) values
  ('expenditure.view',   'expenditure', 'view',   'View Expenditure',   'View expenditure records and payment vouchers'),
  ('expenditure.manage', 'expenditure', 'manage', 'Manage Expenditure', 'Prepare, edit, delete and submit draft expenditure. Approval is a separate permission.')
on conflict (permission_key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label, description = excluded.description;

insert into public.role_permissions (role, permission_id, enabled)
select rp.role, ex.id, rp.enabled
from public.role_permissions rp
join public.app_permissions src on src.id = rp.permission_id and src.permission_key = 'finance.view'
join public.app_permissions ex on ex.permission_key = 'expenditure.view'
on conflict (role, permission_id) do nothing;

-- Reviewers and the Pastor never prepare records, so they do not get Manage.
insert into public.role_permissions (role, permission_id, enabled)
select rp.role, ex.id, rp.enabled
from public.role_permissions rp
join public.app_permissions src on src.id = rp.permission_id and src.permission_key = 'finance.manage'
join public.app_permissions ex on ex.permission_key = 'expenditure.manage'
where rp.role not in ('pastor','finance_reviewer')
on conflict (role, permission_id) do nothing;

-- >>> FILE: migration_59_sms_permission.sql
-- V59: "Send SMS" becomes its own permission, so the Pastor (or any role) can be given it from Role Permissions.
-- Run once. Safe to run again.
--
-- Roles that could send SMS before (Admin and Secretary) keep it. The Pastor does NOT get it automatically:
-- a Super Admin ticks Send SMS for the Pastor under Role Permissions > Pastor > Send SMS, then Save.
-- (To switch it on straight away from SQL instead, run the commented statement at the bottom.)

insert into public.app_permissions (permission_key, module, action, label, description) values
  ('sms.send', 'sms', 'send', 'Send SMS', 'Send SMS messages to members. Tick this for the Pastor or any other role that should be allowed to send SMS.')
on conflict (permission_key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label, description = excluded.description;

insert into public.role_permissions (role, permission_id, enabled)
select rc.role_key, p.id, true
from public.role_catalog rc
cross join public.app_permissions p
where p.permission_key = 'sms.send'
  and rc.role_key <> 'pending'
  and (rc.role_key in ('admin', 'secretary') or rc.base_role in ('admin', 'secretary') and rc.role_key not in ('pastor', 'finance_reviewer'))
on conflict (role, permission_id) do nothing;

-- Optional: give the Pastor SMS right now.
-- insert into public.role_permissions (role, permission_id, enabled)
-- select 'pastor', id, true from public.app_permissions where permission_key = 'sms.send'
-- on conflict (role, permission_id) do update set enabled = true;

-- >>> FILE: migration_60_unique_member_code.sql
-- V60: two members can never share a Member ID again.
-- The Members screen checked this only in the browser, so a bulk import could give many people the same ID.
-- If duplicates still exist this prints a notice and does nothing. Fix them with
-- maintenance_repair_duplicate_member_codes.sql, then run this again.

do $$
begin
  create unique index if not exists members_member_code_unique
    on public.members (lower(trim(member_code)))
    where member_code is not null and trim(member_code) <> '';
exception when unique_violation then
  raise notice 'Duplicate Member IDs still exist, so the rule was not added. Run maintenance_repair_duplicate_member_codes.sql first.';
end $$;

