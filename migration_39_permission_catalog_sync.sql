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
