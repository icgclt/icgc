-- V29: Admin-only test-data reset.
-- Run this migration in Supabase SQL Editor before using Settings > Clear Test Data.
-- It keeps login accounts, roles and database structure. It clears operational records.

create or replace function public.clear_test_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_role() <> 'admin' then
    raise exception 'Only an administrator can clear test data.' using errcode = '42501';
  end if;

  -- Do not delete login/profile records. Clear legacy branch links first so the
  -- unused legacy branch table can also be emptied safely.
  update public.profiles set member_id = null where member_id is not null;
  update public.profiles set branch_id = null where branch_id is not null;

  truncate table
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
end;
$$;

revoke all on function public.clear_test_data() from public, anon;
grant execute on function public.clear_test_data() to authenticated;
