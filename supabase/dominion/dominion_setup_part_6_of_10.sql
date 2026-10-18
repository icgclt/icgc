-- =====================================================================================
-- ICGC Dominion Temple setup - PART 6 of 10
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_38_current_role_permissions.sql
-- V38: Align Role Permissions with the current application structure.
-- Finance is intentionally separate from Welfare.
-- Pending remains an internal account state but is not a configurable permission group.

-- Add the current Finance/Welfare permission catalogue without deleting legacy
-- permission definitions that older records may still reference.
do $$
begin
  insert into public.app_permissions (permission_key, module, action, label, description)
  values
    ('finance.view','finance','view','View Finance','Access Finance Center and financial records'),
    ('finance.manage','finance','manage','Manage Finance','Create, edit and manage Finance Center records'),
    ('finance_reconciliation.view','finance_reconciliation','view','View Reconciliation','Access financial reconciliation'),
    ('finance_reconciliation.manage','finance_reconciliation','manage','Manage Reconciliation','Perform financial checking and reconciliation'),
    ('welfare.view','welfare','view','View Welfare','Access Welfare Dues and Welfare Fund'),
    ('welfare.manage','welfare','manage','Manage Welfare','Create, edit and manage Welfare records')
  on conflict (permission_key) do update set
    module = excluded.module,
    action = excluded.action,
    label = excluded.label,
    description = excluded.description;
exception when undefined_table then
  raise exception 'app_permissions table is missing. Run the application permission schema/migration before V38 current role permissions.';
end $$;

-- Ensure every configurable role has rows for the current Finance/Welfare permissions.
do $$
declare r text; pkey text; pid uuid;
begin
  foreach r in array array['admin','finance','secretary','viewer','member'] loop
    foreach pkey in array array['finance.view','finance.manage','finance_reconciliation.view','finance_reconciliation.manage','welfare.view','welfare.manage'] loop
      select id into pid from public.app_permissions where permission_key = pkey;
      if pid is not null then
        insert into public.role_permissions(role, permission_id, enabled)
        values (
          r, pid,
          case
            when r = 'admin' then true
            when r = 'finance' and pkey in ('finance.view','finance.manage','finance_reconciliation.view','finance_reconciliation.manage') then true
            when r in ('secretary','viewer') and pkey in ('finance.view','finance_reconciliation.view','welfare.view') then true
            else false
          end
        )
        on conflict (role, permission_id) do nothing;
      end if;
    end loop;
  end loop;
end $$;

-- >>> FILE: migration_39_permission_catalog_sync.sql
-- V39.1: Current permission catalogue. Finance and Welfare are separate.
-- Pending is an account state, not a configurable permission group.
insert into public.app_permissions (permission_key,module,action,label,description) values
('dashboard.view','dashboard','view','View Dashboard','Access the main dashboard'),
('members.view','members','view','View Members','View church member records'),('members.create','members','create','Create Members','Create new member records'),('members.edit','members','edit','Edit Members','Edit member records'),('members.delete','members','delete','Delete Members','Delete member records'),
('attendance.view','attendance','view','View Attendance','View attendance records'),('attendance.record','attendance','record','Record Attendance','Create attendance records'),('attendance.edit','attendance','edit','Edit Attendance','Edit attendance records'),('attendance.delete','attendance','delete','Delete Attendance','Delete attendance records'),
('children.view','children','view','View Children','View child records'),('children.manage','children','manage','Manage Children','Create, edit and manage child records'),
('child_checkins.view','child_checkins','view','View Child Check-ins','Access children pickup and release'),('child_checkins.manage','child_checkins','manage','Manage Child Check-ins','Manage children pickup and release'),
('groups.view','groups','view','View Groups','View groups and house fellowships'),('groups.manage','groups','manage','Manage Groups','Create, edit and manage groups'),
('departments.view','departments','view','View Departments','View departments'),('departments.manage','departments','manage','Manage Departments','Create, edit and manage departments'),
('events.view','events','view','View Events','View church events'),('events.manage','events','manage','Manage Events','Create, edit and manage events'),
('visitors.view','visitors','view','View Visitors','View visitors'),('visitors.manage','visitors','manage','Manage Visitors','Create, edit and manage visitors'),
('followups.view','follow_ups','view','View Follow-ups','View follow-up records'),('followups.manage','follow_ups','manage','Manage Follow-ups','Create, edit and manage follow-ups'),
('prayer_requests.view','prayer_requests','view','View Prayer Requests','View prayer requests'),('prayer_requests.manage','prayer_requests','manage','Manage Prayer Requests','Manage prayer requests'),
('pastoral_cases.view','pastoral_care','view','View Pastoral Care','View pastoral care cases and pastoral dashboard'),('pastoral_cases.manage','pastoral_care','manage','Manage Pastoral Care','Create, edit and manage pastoral care cases'),
('notifications.view','notifications','view','View Notifications','View notification tools'),('notifications.manage','notifications','manage','Manage Notifications','Manage church notifications'),
('finance.view','finance','view','View Finance','Access Finance Center and financial records'),('finance.manage','finance','manage','Manage Finance','Create, edit and manage Finance Center records'),
('finance_reconciliation.view','finance_reconciliation','view','View Reconciliation','Access financial reconciliation'),('finance_reconciliation.manage','finance_reconciliation','manage','Manage Reconciliation','Perform financial checking and reconciliation'),
('welfare.view','welfare','view','View Welfare','Access Welfare Dues and Welfare Fund'),('welfare.manage','welfare','manage','Manage Welfare','Create, edit and manage Welfare records'),
('service_plans.view','service_plans','view','View Service Plans','View service plans and service countdown'),('service_plans.manage','service_plans','manage','Manage Service Plans','Create, edit and manage service plans'),
('reports.view','reports','view','View Reports','Access standard reports'),('advanced_reports.view','advanced_reports','view','View Advanced Reports','Access advanced reports'),
('users.view','users','view','View Users','View application users'),('users.manage','users','manage','Manage Users','Create, edit, delete and manage application users'),
('permissions.view','permissions','view','View Permissions','View role permissions'),('permissions.manage','permissions','manage','Manage Permissions','Configure permissions for user groups'),
('settings.view','settings','view','View System Settings','Access system settings'),('settings.manage','settings','manage','Manage System Settings','Change system settings'),
('backup.manage','backup','manage','Manage Backups','Access backup and restore controls'),('clear_test_data.manage','clear_test_data','manage','Clear Test Data','Delete test/demo data')
on conflict(permission_key) do update set module=excluded.module,action=excluded.action,label=excluded.label,description=excluded.description;

do $$ declare r text; p record; begin
  foreach r in array array['admin','finance','secretary','viewer','member'] loop
    for p in select id,permission_key from public.app_permissions where permission_key in (
      'dashboard.view','members.view','members.create','members.edit','members.delete','attendance.view','attendance.record','attendance.edit','attendance.delete','children.view','children.manage','child_checkins.view','child_checkins.manage','groups.view','groups.manage','departments.view','departments.manage','events.view','events.manage','visitors.view','visitors.manage','followups.view','followups.manage','prayer_requests.view','prayer_requests.manage','pastoral_cases.view','pastoral_cases.manage','notifications.view','notifications.manage','finance.view','finance.manage','finance_reconciliation.view','finance_reconciliation.manage','welfare.view','welfare.manage','service_plans.view','service_plans.manage','reports.view','advanced_reports.view','users.view','users.manage','permissions.view','permissions.manage','settings.view','settings.manage','backup.manage','clear_test_data.manage') loop
      insert into public.role_permissions(role,permission_id,enabled) values (r,p.id,case
        when r='admin' then true
        when r='finance' then p.permission_key like 'finance.%' or p.permission_key like 'finance_reconciliation.%'
        when r='secretary' then p.permission_key in ('dashboard.view','members.view','members.create','members.edit','attendance.view','attendance.record','attendance.edit','children.view','children.manage','child_checkins.view','child_checkins.manage','groups.view','groups.manage','departments.view','departments.manage','events.view','events.manage','visitors.view','visitors.manage','followups.view','followups.manage','prayer_requests.view','prayer_requests.manage','pastoral_cases.view','pastoral_cases.manage','notifications.view','notifications.manage','welfare.view','welfare.manage','service_plans.view','service_plans.manage','reports.view')
        when r='viewer' then p.permission_key like '%.view'
        else false end) on conflict(role,permission_id) do nothing;
    end loop;
  end loop;
end $$;

-- >>> FILE: migration_40_member_status_left.sql
-- Add Left as a member status. Left members remain in the database/history but are excluded from active operational rosters.

alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('Active','Inactive','Visitor','Left'));

alter table public.member_status_history drop constraint if exists member_status_history_to_status_check;
alter table public.member_status_history add constraint member_status_history_to_status_check
  check (to_status in ('Active','Inactive','Visitor','Left'));

-- >>> FILE: migration_41_reports_consolidation.sql
-- V40: Reports are consolidated into Advanced Reports.
-- Remove the obsolete standalone Reports permission and give the Finance role
-- access to Advanced Reports so Finance users can export Finance Center reports.

insert into public.app_permissions (permission_key,module,action,label,description) values
('audit.view','audit','view','View Audit Log','View system audit records')
on conflict(permission_key) do update set module=excluded.module, action=excluded.action, label=excluded.label, description=excluded.description;

insert into public.role_permissions(role,permission_id,enabled)
select r.role, p.id, true
from (values ('admin'::text),('secretary'::text),('viewer'::text)) r(role)
cross join public.app_permissions p
where p.permission_key='audit.view'
on conflict(role,permission_id) do update set enabled=excluded.enabled;

delete from public.role_permissions
where permission_id in (select id from public.app_permissions where permission_key = 'reports.view');

delete from public.app_permissions where permission_key = 'reports.view';

insert into public.role_permissions (role, permission_id, enabled)
select 'finance', id, true
from public.app_permissions
where permission_key = 'advanced_reports.view'
on conflict (role, permission_id) do update set enabled = excluded.enabled;

-- >>> FILE: migration_41_custom_roles.sql
-- V41: extensible role groups with a database access template.
-- Super Admin can create additional role groups from Role Permissions.
create table if not exists public.role_catalog (
  role_key text primary key,
  label text not null,
  base_role text not null default 'viewer',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint role_catalog_base_role_check check (base_role in ('admin','finance','secretary','viewer','member'))
);

insert into public.role_catalog(role_key,label,base_role,is_system) values
 ('super_admin','Super Admin','admin',true),
 ('admin','Admin','admin',true),
 ('finance','Finance','finance',true),
 ('secretary','Secretary','secretary',true),
 ('viewer','Viewer','viewer',true),
 ('member','Member','member',true),
 ('sunday_school_teacher','Sunday School Teacher','secretary',true),
 ('pending','Pending','viewer',true)
on conflict (role_key) do update set label=excluded.label, base_role=excluded.base_role, is_system=excluded.is_system;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_fkey;
alter table public.profiles add constraint profiles_role_fkey foreign key (role) references public.role_catalog(role_key);

alter table public.role_catalog enable row level security;
drop policy if exists role_catalog_select on public.role_catalog;
drop policy if exists role_catalog_manage on public.role_catalog;
create policy role_catalog_select on public.role_catalog for select to authenticated using (true);
create policy role_catalog_manage on public.role_catalog for all to authenticated
  using (public.app_role() in ('admin'))
  with check (public.app_role() in ('admin'));

-- Resolve custom roles to their selected database access template for existing RLS policies.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$
  select case
    when p.role = 'super_admin' then 'admin'
    else coalesce(rc.base_role, p.role)
  end
  from public.profiles p
  left join public.role_catalog rc on rc.role_key = p.role
  where p.id = auth.uid()
$$;
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;

-- The role-permission screen still controls the application's feature access.
-- The base_role above is only the database/RLS access template.

-- >>> FILE: migration_42_attendance_once_per_day.sql
-- V42: Attendance may be marked only once per person per calendar day.
-- The application enforces this immediately (including offline use). These indexes
-- provide database-level protection for member/child-linked attendance as well.
-- If this migration reports duplicate rows, review those historical records first;
-- do not delete them automatically.

create index if not exists attendance_member_date_idx
  on public.attendance(member_id, date)
  where member_id is not null;

create index if not exists attendance_child_date_idx
  on public.attendance(child_id, date)
  where child_id is not null;

-- Use a constraint trigger rather than a unique index so existing historical duplicates
-- do not block migration. New/updated rows are rejected when a linked person already has
-- an attendance record for the same date under another service/event.
create or replace function public.prevent_duplicate_daily_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_id is not null and exists (
    select 1 from public.attendance a
    where a.id <> new.id
      and a.date = new.date
      and a.member_id = new.member_id
  ) then
    raise exception 'Attendance can only be marked once per person per day.' using errcode = '23505';
  end if;

  if new.child_id is not null and exists (
    select 1 from public.attendance a
    where a.id <> new.id
      and a.date = new.date
      and a.child_id = new.child_id
  ) then
    raise exception 'Attendance can only be marked once per child per day.' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_once_per_day on public.attendance;
create trigger attendance_once_per_day
before insert or update on public.attendance
for each row execute function public.prevent_duplicate_daily_attendance();
