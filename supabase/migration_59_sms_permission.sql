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
