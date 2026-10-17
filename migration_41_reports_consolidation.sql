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
