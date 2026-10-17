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
