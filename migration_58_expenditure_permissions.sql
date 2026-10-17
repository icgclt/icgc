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
