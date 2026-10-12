-- READ-ONLY. Changes nothing. Run this first in the Testimony Temple Supabase SQL Editor.
-- It lists what your database already has. Every row should say present = true EXCEPT the ones
-- in the "NEW" group, which the upgrade adds (they should say false the first time you run this).
-- If any row in the "EXPECTED" group says false, tell me which one before running the upgrade:
-- it means an older migration was never applied to this database.

select 'EXPECTED' as grp, 'table' as kind, t as name, to_regclass('public.' || t) is not null as present
from unnest(array[
  'members','attendance','giving','events','profiles','audit_log','role_catalog','role_permissions','app_permissions',
  'finance_weekly_reports','finance_weekly_cash_counts','finance_weekly_momo',
  'finance_weekday_collections','finance_weekday_cash_counts','finance_weekday_momo',
  'member_status_history','announcements','pledges','payment_receipts','payment_requests'
]) as t
union all
select 'EXPECTED', 'function', f,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f)
from unnest(array[
  'app_role','set_updated_at','audit_row','next_member_code','update_my_member_profile',
  'clear_must_change_password','clear_test_data','purge_audit_log','auto_purge_audit_log'
]) as f
union all
select 'NEW (expected false before upgrade)', 'table', t, to_regclass('public.' || t) is not null
from unnest(array['expenditures','cashbook_entries','finance_workflow_audit']) as t
union all
select 'NEW (expected false before upgrade)', 'role', r,
  exists (select 1 from public.role_catalog where role_key = r)
from unnest(array['finance_reviewer','pastor']) as r
order by 1, 2, 3;

-- Which statuses do your existing weekly reports use? (Info only.)
select status, count(*) as reports from public.finance_weekly_reports group by status order by status;
