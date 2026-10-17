-- =====================================================================================
-- ICGC Dominion Temple setup - PART 7 of 7
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_43_must_change_password_app_metadata.sql
-- V43: the "must change temporary password" flag moves from user_metadata (which any signed-in
-- user can rewrite through the Auth API) to app_metadata (writable only with the service-role key).

-- 1. Carry over members who still have a pending forced change.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb
where raw_user_meta_data->>'must_change_password' = 'true';

-- 2. The app calls this right after the member sets a new password.
create or replace function public.clear_must_change_password()
returns void
language sql
security definer
set search_path = public, auth
as $$
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'must_change_password'
  where id = auth.uid();
$$;

revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.clear_must_change_password() to authenticated;

-- >>> FILE: migration_44_more_audit_coverage.sql
-- V44: audit coverage for money tables and user accounts.
-- Already audited before this migration: members, attendance, giving, departments, events,
-- offering_entries, member_contributions, welfare_members, welfare_transactions, attendance_headcount,
-- visitors, groups, follow_ups, prayer_requests, volunteers, service_plans, pastoral_cases.
--
-- Not added: role_permissions and role_catalog. They have no uuid "id" column, which audit_row() needs,
-- so a trigger there would make every permission change fail.
do $$
declare t text;
begin
  foreach t in array array[
    'finance_weekly_reports', 'finance_weekly_cash_counts', 'finance_weekly_momo',
    'finance_weekday_collections', 'finance_weekday_cash_counts', 'finance_weekday_momo',
    'finance_reconciliations', 'pledges', 'payment_receipts', 'payment_requests',
    'profiles'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
    end if;
  end loop;
end $$;

-- >>> FILE: migration_45_pastoral_audit_no_content.sql
-- V45: pastoral care is audited without copying its contents.
-- Before: every change stored a full copy of the case (including counselling notes) in audit_log,
-- readable by admins. After: the log keeps who changed a case, what kind of change, and when.

create or replace function public.audit_row_no_content() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  select coalesce(nullif(trim(full_name), ''), email) into v_actor_name
  from public.profiles where id = v_actor;

  insert into public.audit_log (table_name, row_id, action, actor, actor_name)
  values (tg_table_name, v_id, tg_op, v_actor, v_actor_name);

  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function public.audit_row_no_content() from public, anon, authenticated;

drop trigger if exists pastoral_cases_audit on public.pastoral_cases;
create trigger pastoral_cases_audit
  after insert or update or delete on public.pastoral_cases
  for each row execute function public.audit_row_no_content();

-- Remove the copies already stored. This keeps the who / when / action rows and clears only the contents.
-- Delete this statement before running if you want to keep the old copies.
update public.audit_log
set old_row = null, new_row = null
where table_name = 'pastoral_cases' and (old_row is not null or new_row is not null);

-- >>> FILE: migration_46_purge_audit_log.sql
-- V46: lets the Super Admin delete old audit log entries (Audit Log page > "Delete old entries").
-- Only the Super Admin can run it, nothing newer than 30 days can be deleted, and a PURGE row is kept
-- recording who cleaned up, when, and how many entries were removed.
create or replace function public.purge_audit_log(p_older_than_days integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_name text;
  v_cutoff timestamptz;
  v_count integer;
begin
  select role, coalesce(nullif(trim(full_name), ''), email) into v_role, v_name
  from public.profiles where id = v_actor;

  if v_role is distinct from 'super_admin' then
    raise exception 'Only the Super Admin can delete audit log entries.';
  end if;
  if p_older_than_days is null or p_older_than_days < 30 then
    raise exception 'Audit entries from the last 30 days cannot be deleted.';
  end if;

  v_cutoff := now() - make_interval(days => p_older_than_days);
  delete from public.audit_log where at < v_cutoff;
  get diagnostics v_count = row_count;

  insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
  values ('audit_log', null, 'PURGE', v_actor, v_name,
          jsonb_build_object('deleted', v_count, 'older_than', v_cutoff));

  return v_count;
end $$;

revoke all on function public.purge_audit_log(integer) from public, anon;
grant execute on function public.purge_audit_log(integer) to authenticated;

-- >>> FILE: migration_47_auto_purge_audit_log.sql
-- V47: the audit log deletes itself. Every entry is removed once it is older than 30 days.
-- Runs every day at 02:00 GMT (the same as Ghana time), so no entry lives much past a month.
-- To keep entries longer, change both '30 days' below (and run this file again).

create extension if not exists pg_cron;

create or replace function public.auto_purge_audit_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
  v_count integer;
begin
  delete from public.audit_log where at < v_cutoff;
  get diagnostics v_count = row_count;

  -- Leave a short note so the cleanup itself is visible in the Audit Log.
  if v_count > 0 then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
    values ('audit_log', null, 'PURGE', null, 'Automatic cleanup',
            jsonb_build_object('deleted', v_count, 'older_than', v_cutoff));
  end if;
  return v_count;
end $$;

-- Only the scheduler (database owner) runs this; the website cannot call it.
revoke all on function public.auto_purge_audit_log() from public, anon, authenticated;

-- (Re)create the schedule without duplicating it if this file is run twice.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'audit-log-auto-purge') then
    perform cron.unschedule('audit-log-auto-purge');
  end if;
  if exists (select 1 from cron.job where jobname = 'cron-history-cleanup') then
    perform cron.unschedule('cron-history-cleanup');
  end if;
  perform cron.schedule('audit-log-auto-purge', '0 2 * * *', 'select public.auto_purge_audit_log()');
  -- The scheduler keeps its own run history; trim it weekly so it never grows.
  perform cron.schedule('cron-history-cleanup', '0 3 * * 0',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
end $$;

-- >>> FILE: default role permissions (runs last so it is the final word)
-- Starting access for each role, copied from the existing church. The Super Admin can change any of it
-- later in Role Permissions. Rows are created for every permission, switched on only where listed.
insert into public.role_permissions (role, permission_id, enabled)
select v.role, p.id, (p.permission_key = any (v.enabled_keys))
from (values
  ('admin', array['advanced_reports.view', 'attendance.create', 'attendance.delete', 'attendance.edit', 'attendance.record', 'attendance.view', 'child_checkins.manage', 'child_checkins.view', 'children.manage', 'children.view', 'contributions.manage', 'contributions.view', 'dashboard.view', 'departments.manage', 'departments.view', 'events.manage', 'events.view', 'finance_reconciliation.manage', 'finance_reconciliation.view', 'finance.manage', 'finance.view', 'followups.manage', 'followups.view', 'giving.manage', 'giving.view', 'groups.manage', 'groups.view', 'members.create', 'members.delete', 'members.edit', 'members.view', 'notifications.manage', 'notifications.view', 'pastoral_cases.manage', 'pastoral_cases.view', 'payments.manage', 'payments.view', 'prayer_requests.manage', 'prayer_requests.view', 'reports.view', 'service_plans.manage', 'service_plans.view', 'settings.view', 'users.manage', 'users.view', 'visitors.manage', 'visitors.view', 'welfare.manage', 'welfare.view']::text[]),
  ('finance', array['contributions.manage', 'contributions.view', 'dashboard.view', 'finance_reconciliation.manage', 'finance_reconciliation.view', 'finance.manage', 'finance.view', 'giving.manage', 'giving.view', 'members.view', 'notifications.view', 'payments.manage', 'payments.view', 'reports.view']::text[]),
  ('member', array['dashboard.view', 'events.view', 'notifications.view', 'prayer_requests.view']::text[]),
  ('pending', array[]::text[]),
  ('secretary', array['attendance.create', 'attendance.edit', 'attendance.record', 'attendance.view', 'child_checkins.view', 'children.view', 'dashboard.view', 'departments.view', 'events.view', 'followups.manage', 'followups.view', 'groups.view', 'members.view', 'notifications.view', 'reports.view', 'service_plans.manage', 'service_plans.view', 'visitors.manage', 'visitors.view', 'welfare.view']::text[]),
  ('super_admin', array['advanced_reports.view', 'attendance.create', 'attendance.delete', 'attendance.edit', 'attendance.view', 'backup.manage', 'children.manage', 'children.view', 'clear_test_data.manage', 'contributions.manage', 'contributions.view', 'dashboard.view', 'departments.manage', 'departments.view', 'events.manage', 'events.view', 'followups.manage', 'followups.view', 'giving.manage', 'giving.view', 'groups.manage', 'groups.view', 'members.create', 'members.delete', 'members.edit', 'members.view', 'notifications.manage', 'notifications.view', 'payments.manage', 'payments.view', 'permissions.manage', 'permissions.view', 'prayer_requests.manage', 'prayer_requests.view', 'reports.view', 'settings.manage', 'settings.view', 'users.manage', 'users.view', 'visitors.manage', 'visitors.view']::text[]),
  ('viewer', array['advanced_reports.view', 'attendance.view', 'child_checkins.view', 'children.view', 'contributions.view', 'dashboard.view', 'departments.view', 'events.view', 'finance_reconciliation.view', 'finance.view', 'followups.view', 'giving.view', 'groups.view', 'members.view', 'notifications.view', 'pastoral_cases.view', 'payments.view', 'permissions.view', 'prayer_requests.view', 'reports.view', 'service_plans.view', 'settings.view', 'users.view', 'visitors.view', 'welfare.view']::text[])
) as v(role, enabled_keys)
cross join public.app_permissions p
on conflict (role, permission_id) do update set enabled = excluded.enabled, updated_at = now();
