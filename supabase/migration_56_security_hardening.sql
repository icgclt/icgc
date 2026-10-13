-- V56: security hardening. Safe to run more than once. Run AFTER migration 54.
--
-- 1) Only a Super Admin can grant or remove the Super Admin, Pastor and Finance Reviewer roles,
--    and nobody can change their own role. This holds even if the API is called directly.
-- 2) The Pastor and Finance Reviewer roles use the 'finance' access template, which would let them write
--    giving, receipts, pledges and other money tables. The workflow triggers only guard the weekly
--    reports and expenditure, so these roles are shut out of every other money table here.
-- 3) The Pastor can read and write pastoral cases and follow-ups, and read prayer requests, as the Pastoral Dashboard expects.
-- 4) clear_test_data() is Super Admin only, and refuses to run once finance records are approved.

create or replace function public.protect_sensitive_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  -- No signed-in user: SQL editor, Edge Functions using the service key, the sign-up trigger.
  if auth.uid() is null then return new; end if;
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    if new.role in ('super_admin','pastor','finance_reviewer') and actor_role is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can assign the Super Admin, Pastor or Finance Reviewer role.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role.' using errcode = '42501';
    end if;
    if (new.role in ('super_admin','pastor','finance_reviewer') or old.role in ('super_admin','pastor','finance_reviewer'))
       and actor_role is distinct from 'super_admin' then
      raise exception 'Only a Super Admin can grant, change or remove the Super Admin, Pastor or Finance Reviewer role.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_sensitive_roles() from public, anon, authenticated;

drop trigger if exists protect_super_admin_role on public.profiles;   -- name used by an earlier draft
drop function if exists public.protect_super_admin_role();
drop trigger if exists protect_sensitive_roles on public.profiles;
create trigger protect_sensitive_roles
  before insert or update of role on public.profiles
  for each row execute function public.protect_sensitive_roles();

-- Pastor and Finance Reviewer: no writes to money tables outside the guarded review workflow.
do $$
declare t text; cmd text; cond text; pname text;
begin
  cond := $c$coalesce((select role from public.profiles where id = auth.uid()), '') not in ('pastor','finance_reviewer')$c$;
  foreach t in array array[
    'giving','pledges','payment_receipts','payment_requests','finance_reconciliations',
    'offering_entries','member_contributions','welfare_transactions',
    'finance_weekly_cash_counts','finance_weekly_momo',
    'finance_weekday_collections','finance_weekday_cash_counts','finance_weekday_momo',
    'cashbook_entries'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    foreach cmd in array array['insert','update','delete'] loop
      pname := 'no_review_roles_' || cmd;
      execute format('drop policy if exists %I on public.%I', pname, t);
      if cmd = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', pname, t, cond);
      elsif cmd = 'update' then
        execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', pname, t, cond, cond);
      else
        execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', pname, t, cond);
      end if;
    end loop;
  end loop;
end $$;

-- The Pastor leads pastoral care. The Pastoral Dashboard lets the Pastor save pastoral cases and follow-ups, and the
-- Pastor reads prayer requests, but the database only allowed admins and secretaries to do so. No delete.
do $$
declare
  isp text := $c$(select role from public.profiles where id = auth.uid()) = 'pastor'$c$;
begin
  -- pastoral_cases: read, add, edit
  drop policy if exists pastoral_cases_select_pastor on public.pastoral_cases;
  drop policy if exists pastoral_cases_insert_pastor on public.pastoral_cases;
  drop policy if exists pastoral_cases_update_pastor on public.pastoral_cases;
  execute format('create policy pastoral_cases_select_pastor on public.pastoral_cases for select to authenticated using (%s)', isp);
  execute format('create policy pastoral_cases_insert_pastor on public.pastoral_cases for insert to authenticated with check (%s)', isp);
  execute format('create policy pastoral_cases_update_pastor on public.pastoral_cases for update to authenticated using (%s) with check (%s)', isp, isp);
  -- follow_ups: add, edit (reading already works)
  drop policy if exists follow_ups_insert_pastor on public.follow_ups;
  drop policy if exists follow_ups_update_pastor on public.follow_ups;
  execute format('create policy follow_ups_insert_pastor on public.follow_ups for insert to authenticated with check (%s)', isp);
  execute format('create policy follow_ups_update_pastor on public.follow_ups for update to authenticated using (%s) with check (%s)', isp, isp);
  -- prayer_requests: read, edit (for example mark as prayed for)
  drop policy if exists prayer_requests_select_pastor on public.prayer_requests;
  drop policy if exists prayer_requests_update_pastor on public.prayer_requests;
  execute format('create policy prayer_requests_select_pastor on public.prayer_requests for select to authenticated using (%s)', isp);
  execute format('create policy prayer_requests_update_pastor on public.prayer_requests for update to authenticated using (%s) with check (%s)', isp, isp);
end $$;

create or replace function public.clear_test_data()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin') then
    raise exception 'Only a Super Admin can clear test data.' using errcode = '42501';
  end if;
  -- Once finance records have been approved, the audit trail must be kept. Test data can only be cleared before that.
  begin
    if exists (select 1 from public.finance_weekly_reports where status in ('Approved','Rejected'))
       or exists (select 1 from public.expenditures where status in ('Approved','Rejected')) then
      raise exception 'Test data cannot be cleared after financial records have been approved.' using errcode = '42501';
    end if;
  exception when undefined_table or undefined_column then
    null; -- the finance workflow has not been installed yet, so there is nothing locked
  end;
  update public.profiles set member_id = null where member_id is not null;
  update public.profiles set branch_id = null where branch_id is not null;
  truncate table
    public.abc_class_attendance,
    public.member_group_history,
    public.audit_log,
    public.attendance,
    public.giving,
    public.offering_entries,
    public.member_contributions,
    public.welfare_transactions,
    public.welfare_members,
    public.attendance_headcount,
    public.visitors,
    public.groups,
    public.follow_ups,
    public.prayer_requests,
    public.volunteers,
    public.service_plans,
    public.pastoral_cases,
    public.event_registrations,
    public.announcements,
    public.families,
    public.children,
    public.child_checkins,
    public.department_members,
    public.group_members,
    public.group_attendance,
    public.volunteer_schedules,
    public.pledges,
    public.payment_receipts,
    public.communication_templates,
    public.communication_queue,
    public.finance_reconciliations,
    public.branches,
    public.notification_campaigns,
    public.notification_logs,
    public.payment_requests,
    public.payment_webhook_events,
    public.member_notification_preferences,
    public.members,
    public.departments,
    public.events
  restart identity cascade;
end; $$;
revoke all on function public.clear_test_data() from public, anon;
grant execute on function public.clear_test_data() to authenticated;
