-- =====================================================================================
-- ICGC Dominion Temple setup - PART 5 of 10
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_29_clear_test_data.sql
-- V29: Admin-only test-data reset.
-- Run this migration in Supabase SQL Editor before using Settings > Clear Test Data.
-- It keeps login accounts, roles and database structure. It clears operational records.

create or replace function public.clear_test_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'Only an administrator can clear test data.' using errcode = '42501';
  end if;

  -- Do not delete login/profile records. Clear legacy branch links first so the
  -- unused legacy branch table can also be emptied safely.
  update public.profiles set member_id = null where member_id is not null;
  update public.profiles set branch_id = null where branch_id is not null;

  truncate table
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
end;
$$;

revoke all on function public.clear_test_data() from public, anon;
grant execute on function public.clear_test_data() to authenticated;

-- >>> FILE: migration_30_member_ids_auto.sql
-- V30: automatic Dominion Temple member IDs.
-- Adults = DTA1, DTA2...
-- Omega = DTO1, DTO2...
-- Children = DTC1, DTC2...
-- The application's permanent member UUID remains unchanged when a person moves groups.

create or replace function public.next_member_code(p_member_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text := case when p_member_type = 'Child' then 'DTC' when p_member_type = 'Omega' then 'DTO' else 'DTA' end;
  n integer := 1;
  candidate text;
begin
  loop
    candidate := prefix || n;
    if not exists (select 1 from public.members where upper(trim(member_code)) = candidate) then
      return candidate;
    end if;
    n := n + 1;
  end loop;
end;
$$;

grant execute on function public.next_member_code(text) to authenticated;

-- >>> FILE: migration_31_portal_progression_abc.sql
-- V31: phone-based member portal credentials, lifelong member progression, and ABC Class.

alter table public.members add column if not exists portal_enabled boolean not null default false;
alter table public.members add column if not exists portal_created_at timestamptz;

create table if not exists public.member_group_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  from_group text not null,
  to_group text not null,
  from_member_code text,
  to_member_code text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists member_group_history_member_idx on public.member_group_history(member_id, changed_at);
alter table public.member_group_history enable row level security;
drop policy if exists member_group_history_select on public.member_group_history;
create policy member_group_history_select on public.member_group_history for select to authenticated using (public.app_role() in ('admin','secretary','finance','viewer') or member_id = (select member_id from public.profiles where id=auth.uid()));
drop policy if exists member_group_history_insert on public.member_group_history;
create policy member_group_history_insert on public.member_group_history for insert to authenticated with check (public.app_role() in ('admin','secretary'));

-- Preserve every historical code when generating the next code; codes are never reused.
create or replace function public.next_member_code(p_member_type text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text := case when p_member_type = 'Child' then 'DTC' when p_member_type = 'Omega' then 'DTO' else 'DTA' end;
  n integer;
  candidate text;
begin
  select greatest(
    coalesce((select max((substring(upper(trim(member_code)) from 4))::integer) from public.members where upper(trim(member_code)) ~ ('^'||prefix||'[0-9]+$')),0),
    coalesce((select max((substring(upper(trim(from_member_code)) from 4))::integer) from public.member_group_history where upper(trim(from_member_code)) ~ ('^'||prefix||'[0-9]+$')),0),
    coalesce((select max((substring(upper(trim(to_member_code)) from 4))::integer) from public.member_group_history where upper(trim(to_member_code)) ~ ('^'||prefix||'[0-9]+$')),0)
  ) + 1 into n;
  candidate := prefix || n;
  while exists (select 1 from public.members where upper(trim(member_code)) = candidate) loop
    n := n + 1; candidate := prefix || n;
  end loop;
  return candidate;
end; $$;
grant execute on function public.next_member_code(text) to authenticated;

-- ABC Class: a temporary Sunday Bible Study class with an individual weekly register.
alter table public.groups add column if not exists start_date date;
alter table public.groups add column if not exists end_date date;
alter table public.groups add column if not exists number_of_weeks integer;

create table if not exists public.abc_class_attendance (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  week_no integer not null,
  present boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique(group_id, member_id, date)
);
create index if not exists abc_class_attendance_date_idx on public.abc_class_attendance(group_id,date);
alter table public.abc_class_attendance enable row level security;
drop policy if exists abc_class_attendance_select on public.abc_class_attendance;
create policy abc_class_attendance_select on public.abc_class_attendance for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
drop policy if exists abc_class_attendance_insert on public.abc_class_attendance;
create policy abc_class_attendance_insert on public.abc_class_attendance for insert to authenticated with check (public.app_role() in ('admin','secretary'));
drop policy if exists abc_class_attendance_update on public.abc_class_attendance;
create policy abc_class_attendance_update on public.abc_class_attendance for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
drop policy if exists abc_class_attendance_delete on public.abc_class_attendance;
create policy abc_class_attendance_delete on public.abc_class_attendance for delete to authenticated using (public.app_role()='admin');


alter table public.follow_ups add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.prayer_requests add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.pastoral_cases add column if not exists member_id uuid references public.members(id) on delete set null;
create index if not exists follow_ups_member_idx on public.follow_ups(member_id);
create index if not exists prayer_requests_member_idx on public.prayer_requests(member_id);
create index if not exists pastoral_cases_member_idx on public.pastoral_cases(member_id);

-- >>> FILE: migration_32_clear_new_test_data.sql
-- V33: extend the admin test-data reset for V31 records.
create or replace function public.clear_test_data()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() <> 'admin' then raise exception 'Only an administrator can clear test data.' using errcode = '42501'; end if;
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

-- >>> FILE: migration_33_super_admin.sql
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

-- >>> FILE: migration_34_member_photos.sql
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

-- >>> FILE: finance_workbook_model_v35.sql
-- Church Management v35
-- Finance model based on the church's weekly cash-counting workbook.
-- Attendance is intentionally NOT included here.

create table if not exists public.finance_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  week_no smallint not null check (week_no between 1 and 5),
  year integer not null,
  month smallint not null check (month between 1 and 12),
  status text not null default 'Draft' check (status in ('Draft','Submitted','Checked','Approved')),
  prepared_by_name text,
  checked_by_name text,
  approved_by_name text,
  notes text,
  total_cash numeric(14,2) not null default 0,
  total_momo numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(date, week_no)
);

create table if not exists public.finance_weekly_cash_counts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  category text not null,
  denomination numeric(10,2) not null check (denomination in (200,100,50,20,10,5,2,1,0.5,0.2,0.1)),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, category, denomination)
);

create table if not exists public.finance_weekly_momo (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  category text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  provider text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, category)
);

create index if not exists idx_finance_weekly_reports_year_month on public.finance_weekly_reports(year, month);
create index if not exists idx_finance_weekly_cash_report on public.finance_weekly_cash_counts(report_id);
create index if not exists idx_finance_weekly_momo_report on public.finance_weekly_momo(report_id);

-- Reuse the same lightweight role pattern used elsewhere in the app.
alter table public.finance_weekly_reports enable row level security;
alter table public.finance_weekly_cash_counts enable row level security;
alter table public.finance_weekly_momo enable row level security;

drop policy if exists finance_weekly_reports_read on public.finance_weekly_reports;
create policy finance_weekly_reports_read on public.finance_weekly_reports
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_reports_write on public.finance_weekly_reports;
create policy finance_weekly_reports_write on public.finance_weekly_reports
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekly_cash_counts_read on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_read on public.finance_weekly_cash_counts
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_cash_counts_write on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_write on public.finance_weekly_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekly_momo_read on public.finance_weekly_momo;
create policy finance_weekly_momo_read on public.finance_weekly_momo
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_momo_write on public.finance_weekly_momo;
create policy finance_weekly_momo_write on public.finance_weekly_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

-- >>> FILE: migration_35_member_status_history.sql
-- Member status history and safe reactivation workflow.
-- Stores only lightweight audit metadata; member records themselves are retained.

alter table public.members add column if not exists status_reason text;
alter table public.members add column if not exists status_notes text;
alter table public.members add column if not exists status_changed_at timestamptz default now();

create table if not exists public.member_status_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('Active','Inactive','Visitor','Left')),
  reason text,
  notes text,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index if not exists member_status_history_member_idx
  on public.member_status_history(member_id, changed_at desc);

alter table public.member_status_history enable row level security;

drop policy if exists member_status_history_select on public.member_status_history;
create policy member_status_history_select on public.member_status_history
  for select to authenticated
  using (public.app_role() in ('admin','finance','secretary','viewer'));

drop policy if exists member_status_history_insert on public.member_status_history;
create policy member_status_history_insert on public.member_status_history
  for insert to authenticated
  with check (public.app_role() in ('admin','secretary'));

drop policy if exists member_status_history_update on public.member_status_history;
create policy member_status_history_update on public.member_status_history
  for update to authenticated
  using (public.app_role() in ('admin'))
  with check (public.app_role() in ('admin'));

drop policy if exists member_status_history_delete on public.member_status_history;
create policy member_status_history_delete on public.member_status_history
  for delete to authenticated
  using (public.app_role() in ('admin'));

create or replace function public.set_member_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_status_timestamp on public.members;
create trigger trg_member_status_timestamp
before update of status on public.members
for each row execute function public.set_member_status_changed_at();

create or replace function public.record_member_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.member_status_history(member_id, from_status, to_status, reason, notes, changed_at, changed_by)
    values (new.id, null, new.status, coalesce(nullif(trim(new.status_reason), ''), 'Member created'), new.status_notes, coalesce(new.status_changed_at, now()), coalesce(auth.uid(), new.created_by));
  elsif new.status is distinct from old.status then
    insert into public.member_status_history(member_id, from_status, to_status, reason, notes, changed_at, changed_by)
    values (new.id, old.status, new.status,
      nullif(trim(coalesce(new.status_reason, '')), ''),
      nullif(trim(coalesce(new.status_notes, '')), ''),
      coalesce(new.status_changed_at, now()), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_status_history on public.members;
create trigger trg_member_status_history
after insert or update of status on public.members
for each row execute function public.record_member_status_history();

-- Backfill a lightweight initial status event for existing members only when no history exists.
insert into public.member_status_history(member_id, from_status, to_status, reason, changed_at, changed_by)
select m.id, null, m.status, 'History started', coalesce(m.status_changed_at, m.created_at, now()), m.created_by
from public.members m
where not exists (select 1 from public.member_status_history h where h.member_id = m.id);

-- >>> FILE: migration_36_audit_actor_names.sql
-- Human-readable audit actors. Existing audit rows are resolved in the UI from profiles;
-- new rows also store a snapshot so the name remains visible even if a profile changes later.
alter table public.audit_log add column if not exists actor_name text;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  select coalesce(nullif(trim(full_name), ''), email) into v_actor_name
  from public.profiles where id = v_actor;

  if tg_op = 'DELETE' then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, old_row)
    values (tg_table_name, old.id, tg_op, v_actor, v_actor_name, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, old_row, new_row)
    values (tg_table_name, new.id, tg_op, v_actor, v_actor_name, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
    values (tg_table_name, new.id, tg_op, v_actor, v_actor_name, to_jsonb(new));
    return new;
  end if;
end $$;

revoke all on function public.audit_row() from public, anon, authenticated;

-- >>> FILE: finance_weekday_collections_v36.sql
-- Finance v36: Weekday Offering is collected on separate days.
-- Each real collection (Tuesday, Thursday, or a special-program day) is stored separately.
-- Apply this migration before using the updated Finance Center.

create table if not exists public.finance_weekday_collections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  collection_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_weekday_cash_counts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.finance_weekday_collections(id) on delete cascade,
  denomination numeric(10,2) not null check (denomination in (200,100,50,20,10,5,2,1,0.5,0.2,0.1)),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(collection_id, denomination)
);

create table if not exists public.finance_weekday_momo (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.finance_weekday_collections(id) on delete cascade,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  provider text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(collection_id)
);

create index if not exists idx_finance_weekday_collections_report on public.finance_weekday_collections(report_id);
create index if not exists idx_finance_weekday_collections_date on public.finance_weekday_collections(collection_date);
create index if not exists idx_finance_weekday_cash_collection on public.finance_weekday_cash_counts(collection_id);
create index if not exists idx_finance_weekday_momo_collection on public.finance_weekday_momo(collection_id);

alter table public.finance_weekday_collections enable row level security;
alter table public.finance_weekday_cash_counts enable row level security;
alter table public.finance_weekday_momo enable row level security;

drop policy if exists finance_weekday_collections_read on public.finance_weekday_collections;
create policy finance_weekday_collections_read on public.finance_weekday_collections
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_collections_write on public.finance_weekday_collections;
create policy finance_weekday_collections_write on public.finance_weekday_collections
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekday_cash_counts_read on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_read on public.finance_weekday_cash_counts
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_cash_counts_write on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_write on public.finance_weekday_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekday_momo_read on public.finance_weekday_momo;
create policy finance_weekday_momo_read on public.finance_weekday_momo
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_momo_write on public.finance_weekday_momo;
create policy finance_weekday_momo_write on public.finance_weekday_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

-- >>> FILE: migration_37_children_attendance_groups.sql
-- V37: children's attendance groups/classes
-- Stores a lightweight group/class label on each child for quick attendance.
-- Existing children remain safe and appear under Unassigned until assigned.

alter table public.children
  add column if not exists attendance_group text;

create index if not exists children_attendance_group_idx
  on public.children(attendance_group);
