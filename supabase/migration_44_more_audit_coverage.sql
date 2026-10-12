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
