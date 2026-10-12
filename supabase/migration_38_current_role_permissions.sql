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
