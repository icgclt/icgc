-- =====================================================================================
-- ICGC Dominion Temple setup - PART 4 of 7
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_19_branch_ministry_intelligence.sql
-- V19: Branch and Ministry Intelligence
-- Adds branch ownership to finance records so branch dashboards can report finance activity.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='giving' and column_name='branch_id') then
    alter table public.giving add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='offering_entries' and column_name='branch_id') then
    alter table public.offering_entries add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='member_contributions' and column_name='branch_id') then
    alter table public.member_contributions add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='payment_receipts' and column_name='branch_id') then
    alter table public.payment_receipts add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_ups' and column_name='branch_id') then
    alter table public.follow_ups add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='prayer_requests' and column_name='branch_id') then
    alter table public.prayer_requests add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='volunteers' and column_name='branch_id') then
    alter table public.volunteers add column branch_id uuid references public.branches(id);
  end if;
end $$;

create index if not exists giving_branch_id_idx on public.giving(branch_id);
create index if not exists offering_entries_branch_id_idx on public.offering_entries(branch_id);
create index if not exists member_contributions_branch_id_idx on public.member_contributions(branch_id);
create index if not exists payment_receipts_branch_id_idx on public.payment_receipts(branch_id);
create index if not exists follow_ups_branch_id_idx on public.follow_ups(branch_id);
create index if not exists prayer_requests_branch_id_idx on public.prayer_requests(branch_id);
create index if not exists volunteers_branch_id_idx on public.volunteers(branch_id);

-- Existing RLS policies remain unchanged. branch_id is nullable so existing records continue to work.

-- >>> FILE: migration_20_branch_assignment.sql
-- V20: Branch Assignment & Management
-- Ensures all core records used by branch operations can safely carry a branch assignment.
-- (attendance_headcount was missing its branch column here, which V21 needs; added.)

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attendance_headcount' and column_name='branch_id') then alter table public.attendance_headcount add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='families' and column_name='branch_id') then alter table public.families add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='children' and column_name='branch_id') then alter table public.children add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='child_checkins' and column_name='branch_id') then alter table public.child_checkins add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pledges' and column_name='branch_id') then alter table public.pledges add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='payment_requests' and column_name='branch_id') then alter table public.payment_requests add column branch_id uuid references public.branches(id); end if;
end $$;

create index if not exists attendance_headcount_branch_id_idx on public.attendance_headcount(branch_id);
create index if not exists families_branch_id_idx on public.families(branch_id);
create index if not exists children_branch_id_idx on public.children(branch_id);
create index if not exists child_checkins_branch_id_idx on public.child_checkins(branch_id);
create index if not exists pledges_branch_id_idx on public.pledges(branch_id);
create index if not exists payment_requests_branch_id_idx on public.payment_requests(branch_id);

-- Assignment is performed through the admin-only Branch Assignment page. Existing RLS remains in force.

-- >>> FILE: migration_21_branch_level_access.sql
-- V21: Branch-Level Access Control
-- Adds a branch_admin role and restricts branch administrators to their assigned branch.

-- Extend the profile role constraint safely.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin','finance','secretary','viewer','branch_admin','member','pending'));

-- Returns the signed-in user's branch without recursively querying profiles through RLS.
create or replace function public.app_branch_id() returns uuid
language sql stable security definer set search_path = public
as $$ select branch_id from public.profiles where id = auth.uid() $$;

revoke all on function public.app_branch_id() from public, anon;
grant execute on function public.app_branch_id() to authenticated;

-- A branch administrator must have a branch assigned.
create or replace function public.branch_admin_has_branch() returns boolean
language sql stable security definer set search_path = public
as $$ select public.app_role() <> 'branch_admin' or public.app_branch_id() is not null $$;

revoke all on function public.branch_admin_has_branch() from public, anon;
grant execute on function public.branch_admin_has_branch() to authenticated;

-- Branch administrators can see the branch directory, but cannot modify branches.
-- The existing branches policies from V14 remain in force for admins.

-- Operational branch-scoped tables.
do $$
declare t text;
begin
  foreach t in array array[
    'members','attendance','attendance_headcount','departments','events','groups','visitors',
    'follow_ups','prayer_requests','volunteers','families','children','child_checkins','pledges','payment_requests'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'branch_admin_select_'||t, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_select_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_insert_'||t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_insert_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_update_'||t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id()) with check (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_update_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_delete_'||t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_delete_'||t, t);
  end loop;
end $$;

-- Finance records are visible to branch administrators for branch reporting,
-- but remain editable only by admin/finance users.
do $$
declare t text;
begin
  foreach t in array array['giving','offering_entries','member_contributions','payment_receipts'] loop
    execute format('drop policy if exists %I on public.%I', 'branch_admin_finance_select_'||t, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_finance_select_'||t, t);
  end loop;
end $$;

-- Profiles: administrators can assign branch_admin and branch_id through the existing
-- admin profile update policy. Branch admins can read only their own profile as before.

create index if not exists profiles_branch_id_idx on public.profiles(branch_id);

-- Prevent a branch_admin from existing without a branch when the role is assigned.
create or replace function public.validate_profile_branch() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'branch_admin' and new.branch_id is null then
    raise exception 'A branch administrator must be assigned to a branch';
  end if;
  return new;
end $$;

 drop trigger if exists validate_profile_branch on public.profiles;
 create trigger validate_profile_branch before insert or update of role, branch_id on public.profiles
 for each row execute function public.validate_profile_branch();

-- Ministry join tables are scoped through their parent branch.
create policy branch_admin_department_members_select on public.department_members
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_insert on public.department_members
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_update on public.department_members
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_delete on public.department_members
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_group_members_select on public.group_members
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_insert on public.group_members
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_update on public.group_members
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_delete on public.group_members
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_group_attendance_select on public.group_attendance
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_insert on public.group_attendance
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_update on public.group_attendance
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_delete on public.group_attendance
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_volunteer_schedules_select on public.volunteer_schedules
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_insert on public.volunteer_schedules
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_update on public.volunteer_schedules
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_delete on public.volunteer_schedules
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);

-- >>> FILE: migration_22_permission_tables.sql
-- V22 (rebuilt): the permission tables behind Settings > Role Permissions.
-- The original migration for these tables was missing from the project, so this file recreates them
-- exactly as they exist in the live database. It is safe to run on a database that already has them.

create table if not exists public.app_permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  module text not null,
  action text not null,
  label text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  permission_id uuid not null references public.app_permissions(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, permission_id)
);

create index if not exists idx_role_permissions_role on public.role_permissions (role);
create index if not exists idx_role_permissions_permission on public.role_permissions (permission_id);

alter table public.app_permissions enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "Authenticated users can view permissions" on public.app_permissions;
create policy "Authenticated users can view permissions" on public.app_permissions
  for select to authenticated using (true);

drop policy if exists "Super Admins can manage permissions" on public.app_permissions;
create policy "Super Admins can manage permissions" on public.app_permissions
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "Super Admins can manage role permissions" on public.role_permissions;
create policy "Super Admins can manage role permissions" on public.role_permissions
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "Super Admins can view all role permissions" on public.role_permissions;
create policy "Super Admins can view all role permissions" on public.role_permissions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "Users can view their own role permissions" on public.role_permissions;
create policy "Users can view their own role permissions" on public.role_permissions
  for select to authenticated
  using (role = (select p.role from public.profiles p where p.id = auth.uid()));

-- The list of permissions the app knows about (never overwrites anything already there).
insert into public.app_permissions (permission_key, module, action, label, description) values
  ('advanced_reports.view', 'advanced_reports', 'view', 'View Advanced Reports', 'Access advanced reports'),
  ('attendance.create', 'Attendance', 'create', 'Record Attendance', 'Create attendance records'),
  ('attendance.delete', 'attendance', 'delete', 'Delete Attendance', 'Delete attendance records'),
  ('attendance.edit', 'attendance', 'edit', 'Edit Attendance', 'Edit attendance records'),
  ('attendance.record', 'attendance', 'record', 'Record Attendance', 'Create attendance records'),
  ('attendance.view', 'attendance', 'view', 'View Attendance', 'View attendance records'),
  ('audit.view', 'audit', 'view', 'View Audit Log', 'View system audit records'),
  ('backup.manage', 'backup', 'manage', 'Manage Backups', 'Access backup and restore controls'),
  ('child_checkins.manage', 'child_checkins', 'manage', 'Manage Child Check-ins', 'Manage children pickup and release'),
  ('child_checkins.view', 'child_checkins', 'view', 'View Child Check-ins', 'Access children pickup and release'),
  ('children.manage', 'children', 'manage', 'Manage Children', 'Create, edit and manage child records'),
  ('children.view', 'children', 'view', 'View Children', 'View child records'),
  ('clear_test_data.manage', 'clear_test_data', 'manage', 'Clear Test Data', 'Delete test/demo data'),
  ('contributions.manage', 'Contributions', 'manage', 'Manage Contributions', 'Manage member contributions'),
  ('contributions.view', 'Contributions', 'view', 'View Contributions', 'View member contributions'),
  ('dashboard.view', 'dashboard', 'view', 'View Dashboard', 'Access the main dashboard'),
  ('departments.manage', 'departments', 'manage', 'Manage Departments', 'Create, edit and manage departments'),
  ('departments.view', 'departments', 'view', 'View Departments', 'View departments'),
  ('events.manage', 'events', 'manage', 'Manage Events', 'Create, edit and manage events'),
  ('events.view', 'events', 'view', 'View Events', 'View church events'),
  ('finance_reconciliation.manage', 'finance_reconciliation', 'manage', 'Manage Reconciliation', 'Perform financial checking and reconciliation'),
  ('finance_reconciliation.view', 'finance_reconciliation', 'view', 'View Reconciliation', 'Access financial reconciliation'),
  ('finance.manage', 'finance', 'manage', 'Manage Finance', 'Create, edit and manage Finance Center records'),
  ('finance.view', 'finance', 'view', 'View Finance', 'Access Finance Center and financial records'),
  ('followups.manage', 'follow_ups', 'manage', 'Manage Follow-ups', 'Create, edit and manage follow-ups'),
  ('followups.view', 'follow_ups', 'view', 'View Follow-ups', 'View follow-up records'),
  ('giving.manage', 'Giving', 'manage', 'Manage Giving', 'Manage giving records'),
  ('giving.view', 'Giving', 'view', 'View Giving', 'View giving records'),
  ('groups.manage', 'groups', 'manage', 'Manage Groups', 'Create, edit and manage groups'),
  ('groups.view', 'groups', 'view', 'View Groups', 'View groups and house fellowships'),
  ('members.create', 'members', 'create', 'Create Members', 'Create new member records'),
  ('members.delete', 'members', 'delete', 'Delete Members', 'Delete member records'),
  ('members.edit', 'members', 'edit', 'Edit Members', 'Edit member records'),
  ('members.view', 'members', 'view', 'View Members', 'View church member records'),
  ('notifications.manage', 'notifications', 'manage', 'Manage Notifications', 'Manage church notifications'),
  ('notifications.view', 'notifications', 'view', 'View Notifications', 'View notification tools'),
  ('pastoral_cases.manage', 'pastoral_care', 'manage', 'Manage Pastoral Care', 'Create, edit and manage pastoral care cases'),
  ('pastoral_cases.view', 'pastoral_care', 'view', 'View Pastoral Care', 'View pastoral care cases and pastoral dashboard'),
  ('payments.manage', 'Payment Requests', 'manage', 'Manage Payment Requests', 'Manage payment requests'),
  ('payments.view', 'Payment Requests', 'view', 'View Payment Requests', 'View payment requests'),
  ('permissions.manage', 'permissions', 'manage', 'Manage Permissions', 'Configure permissions for user groups'),
  ('permissions.view', 'permissions', 'view', 'View Permissions', 'View role permissions'),
  ('prayer_requests.manage', 'prayer_requests', 'manage', 'Manage Prayer Requests', 'Manage prayer requests'),
  ('prayer_requests.view', 'prayer_requests', 'view', 'View Prayer Requests', 'View prayer requests'),
  ('reports.view', 'reports', 'view', 'View Reports', 'Access standard reports'),
  ('service_plans.manage', 'service_plans', 'manage', 'Manage Service Plans', 'Create, edit and manage service plans'),
  ('service_plans.view', 'service_plans', 'view', 'View Service Plans', 'View service plans and service countdown'),
  ('settings.manage', 'settings', 'manage', 'Manage System Settings', 'Change system settings'),
  ('settings.view', 'settings', 'view', 'View System Settings', 'Access system settings'),
  ('users.manage', 'users', 'manage', 'Manage Users', 'Create, edit, delete and manage application users'),
  ('users.view', 'users', 'view', 'View Users', 'View application users'),
  ('visitors.manage', 'visitors', 'manage', 'Manage Visitors', 'Create, edit and manage visitors'),
  ('visitors.view', 'visitors', 'view', 'View Visitors', 'View visitors'),
  ('welfare.manage', 'welfare', 'manage', 'Manage Welfare', 'Create, edit and manage Welfare records'),
  ('welfare.view', 'welfare', 'view', 'View Welfare', 'Access Welfare Dues and Welfare Fund')
on conflict (permission_key) do nothing;

-- >>> FILE: migration_24_member_records_contributions.sql
-- V24: member-linked First Fruit / Welfare Dues and Member Record support
-- Run after the existing migrations.

alter table public.member_contributions
  add column if not exists member_id uuid references public.members(id) on delete set null;

create index if not exists member_contributions_member_id_idx
  on public.member_contributions(member_id);

-- Backfill existing records where the member can be matched by name.
update public.member_contributions mc
set member_id = m.id
from public.members m
where mc.member_id is null
  and lower(trim(mc.person_name)) = lower(trim(m.name));

-- Keep the existing fund/person/month uniqueness so old data remains compatible.
-- New records use member_id as well, while person_name remains as a readable snapshot.

-- >>> FILE: migration_25_member_ids_children_attendance.sql
-- V25: manual member IDs and Children Department quick attendance
-- Existing member IDs are preserved. New IDs are entered by administrators.

alter table public.attendance add column if not exists child_id uuid references public.children(id) on delete set null;
create index if not exists attendance_child_id_idx on public.attendance(child_id);

-- Prevent duplicate member IDs at database level.
create unique index if not exists members_member_code_unique_idx
  on public.members (lower(trim(member_code)))
  where member_code is not null and trim(member_code) <> '';

-- >>> FILE: migration_26_member_group_type.sql
-- V26: distinguish the three church groups in the unified member database.
alter table public.members
  add column if not exists member_type text not null default 'Adult';

update public.members
set member_type = case
  when lower(coalesce(member_type,'')) in ('adult','omega','child') then member_type
  else 'Adult'
end;

alter table public.members
  drop constraint if exists members_member_type_check;

alter table public.members
  add constraint members_member_type_check
  check (member_type in ('Adult','Omega','Child'));

create index if not exists members_member_type_idx on public.members(member_type);

-- >>> FILE: migration_27_child_member_parents.sql
-- V27: keep children in the main Members module and capture parent/guardian particulars.
alter table public.members add column if not exists parent1_name text;
alter table public.members add column if not exists parent1_phone text;
alter table public.members add column if not exists parent1_relationship text;
alter table public.members add column if not exists parent2_name text;
alter table public.members add column if not exists parent2_phone text;
alter table public.members add column if not exists parent2_relationship text;

create index if not exists members_parent1_phone_idx on public.members(parent1_phone);
create index if not exists members_parent2_phone_idx on public.members(parent2_phone);
