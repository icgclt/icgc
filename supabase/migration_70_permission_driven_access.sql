-- V70: EVERY screen follows Role Permissions (database side).
-- Run once in the Supabase SQL Editor for EACH church (DT and TT). Safe to re-run.
-- If you already ran the earlier "finance screens" version of migration 70, just run this one too: it replaces it.
--
-- Problem this fixes: you tick a permission under Role Permissions, the menu shows the screen, but the database still
-- decided by the group's database access template (admin / finance / secretary / viewer) and refused the data or the save.
--
-- What it does: ADDS permission-based policies next to the existing ones. In Postgres, row policies are "either one
-- allows it", so nobody who had access before loses it. Nothing existing is dropped or edited.
--   * view  -> the "View ..." permission of that screen
--   * add / edit -> the "Manage ..." permission (Members: Create / Edit, Attendance: Record / Edit)
--   * delete -> only where a real delete permission exists (Members, Attendance) or for Service Timer items;
--               everything else stays Admin only, as before.
--
-- Rules that still apply on top, unchanged:
--   * Pastor and Finance Reviewer still cannot change money tables (migration 56 blocks it whatever is ticked).
--   * For money tables, a group that can Review & Approve can never change them through this route (separation of duties).
--   * Prayer Requests and Pastoral Care stay private to the Pastor.
--   * Not changed here (they keep their own approve / lock / reopen workflow): writing Finance Center weekly reports,
--     Deposit Slips and bank settings. Those are readable by "View Finance" but still saved by the Finance template.
--     Users, Settings, Backup and Clear Test Data stay Admin / Super Admin only by design.

-- Helper used only by this migration. It has its own name (perm_ticked) on purpose: your database already has a
-- has_permission() function written by an earlier script, and this migration must not overwrite or depend on it.
create or replace function public.perm_ticked(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.role = 'super_admin' from public.profiles p where p.id = auth.uid())
    or exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role = p.role and rp.enabled
      join public.app_permissions ap on ap.id = rp.permission_id
      where p.id = auth.uid() and ap.permission_key = p_key
    ),
    false)
$$;
revoke all on function public.perm_ticked(text) from public, anon;
grant execute on function public.perm_ticked(text) to authenticated;

do $mig$
declare
  cfg jsonb := $cfg$[
 {
  "t": "members",
  "select": [
   "members.view",
   "attendance.view",
   "children.view",
   "child_checkins.view",
   "groups.view",
   "departments.view",
   "events.view",
   "visitors.view",
   "followups.view",
   "finance.view",
   "welfare.view",
   "notifications.view",
   "service_plans.view",
   "advanced_reports.view"
  ],
  "insert": [
   "members.create"
  ],
  "update": [
   "members.edit"
  ],
  "delete": [
   "members.delete"
  ]
 },
 {
  "t": "attendance",
  "select": [
   "attendance.view",
   "advanced_reports.view"
  ],
  "insert": [
   "attendance.record"
  ],
  "update": [
   "attendance.record",
   "attendance.edit"
  ],
  "delete": [
   "attendance.delete"
  ]
 },
 {
  "t": "attendance_headcount",
  "select": [
   "attendance.view",
   "advanced_reports.view"
  ],
  "insert": [
   "attendance.record"
  ],
  "update": [
   "attendance.record",
   "attendance.edit"
  ],
  "delete": [
   "attendance.delete"
  ]
 },
 {
  "t": "children",
  "select": [
   "children.view",
   "child_checkins.view"
  ],
  "insert": [
   "children.manage"
  ],
  "update": [
   "children.manage"
  ]
 },
 {
  "t": "families",
  "select": [
   "children.view",
   "child_checkins.view"
  ],
  "insert": [
   "children.manage"
  ],
  "update": [
   "children.manage"
  ]
 },
 {
  "t": "child_checkins",
  "select": [
   "child_checkins.view"
  ],
  "insert": [
   "child_checkins.manage"
  ],
  "update": [
   "child_checkins.manage"
  ]
 },
 {
  "t": "departments",
  "select": [
   "departments.view"
  ],
  "insert": [
   "departments.manage"
  ],
  "update": [
   "departments.manage"
  ]
 },
 {
  "t": "department_members",
  "select": [
   "departments.view"
  ],
  "insert": [
   "departments.manage"
  ],
  "update": [
   "departments.manage"
  ]
 },
 {
  "t": "volunteers",
  "select": [
   "departments.view"
  ],
  "insert": [
   "departments.manage"
  ],
  "update": [
   "departments.manage"
  ]
 },
 {
  "t": "volunteer_schedules",
  "select": [
   "departments.view"
  ],
  "insert": [
   "departments.manage"
  ],
  "update": [
   "departments.manage"
  ]
 },
 {
  "t": "events",
  "select": [
   "events.view"
  ],
  "insert": [
   "events.manage"
  ],
  "update": [
   "events.manage"
  ]
 },
 {
  "t": "event_registrations",
  "select": [
   "events.view"
  ],
  "insert": [
   "events.manage"
  ],
  "update": [
   "events.manage"
  ]
 },
 {
  "t": "groups",
  "select": [
   "groups.view"
  ],
  "insert": [
   "groups.manage"
  ],
  "update": [
   "groups.manage"
  ]
 },
 {
  "t": "group_members",
  "select": [
   "groups.view"
  ],
  "insert": [
   "groups.manage"
  ],
  "update": [
   "groups.manage"
  ]
 },
 {
  "t": "group_attendance",
  "select": [
   "groups.view"
  ],
  "insert": [
   "groups.manage"
  ],
  "update": [
   "groups.manage"
  ]
 },
 {
  "t": "member_group_history",
  "select": [
   "groups.view"
  ],
  "insert": [
   "groups.manage"
  ],
  "update": [
   "groups.manage"
  ]
 },
 {
  "t": "abc_class_attendance",
  "select": [
   "groups.view"
  ],
  "insert": [
   "groups.manage"
  ],
  "update": [
   "groups.manage"
  ]
 },
 {
  "t": "visitors",
  "select": [
   "visitors.view"
  ],
  "insert": [
   "visitors.manage"
  ],
  "update": [
   "visitors.manage"
  ]
 },
 {
  "t": "follow_ups",
  "select": [
   "followups.view"
  ],
  "insert": [
   "followups.manage"
  ],
  "update": [
   "followups.manage"
  ]
 },
 {
  "t": "service_plans",
  "select": [
   "service_plans.view"
  ],
  "insert": [
   "service_plans.manage"
  ],
  "update": [
   "service_plans.manage"
  ]
 },
 {
  "t": "service_timer_items",
  "select": [
   "service_plans.view"
  ],
  "insert": [
   "service_plans.manage"
  ],
  "update": [
   "service_plans.manage"
  ],
  "delete": [
   "service_plans.manage"
  ]
 },
 {
  "t": "welfare_members",
  "select": [
   "welfare.view"
  ],
  "insert": [
   "welfare.manage"
  ],
  "update": [
   "welfare.manage"
  ]
 },
 {
  "t": "welfare_transactions",
  "sod": true,
  "select": [
   "welfare.view",
   "finance.view"
  ],
  "insert": [
   "welfare.manage"
  ],
  "update": [
   "welfare.manage"
  ]
 },
 {
  "t": "member_contributions",
  "sod": true,
  "select": [
   "finance.view",
   "welfare.view"
  ],
  "insert": [
   "finance.manage",
   "welfare.manage"
  ],
  "update": [
   "finance.manage",
   "welfare.manage"
  ]
 },
 {
  "t": "giving",
  "sod": true,
  "select": [
   "finance.view"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "offering_entries",
  "sod": true,
  "select": [
   "finance.view"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "pledges",
  "sod": true,
  "select": [
   "finance.view"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "payment_receipts",
  "sod": true,
  "select": [
   "finance.view"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "payment_requests",
  "sod": true,
  "select": [
   "finance.view"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "finance_reconciliations",
  "sod": true,
  "select": [
   "finance_reconciliation.view",
   "finance_reconciliation.manage"
  ],
  "insert": [
   "finance_reconciliation.manage"
  ],
  "update": [
   "finance_reconciliation.manage"
  ],
  "delete": [
   "finance_reconciliation.manage"
  ]
 },
 {
  "t": "cashbook_entries",
  "sod": true,
  "select": [
   "finance.view",
   "finance.manage"
  ],
  "insert": [
   "finance.manage"
  ],
  "update": [
   "finance.manage"
  ]
 },
 {
  "t": "communication_templates",
  "select": [
   "notifications.view"
  ],
  "insert": [
   "notifications.manage"
  ],
  "update": [
   "notifications.manage"
  ]
 },
 {
  "t": "communication_queue",
  "select": [
   "notifications.view"
  ],
  "insert": [
   "notifications.manage"
  ],
  "update": [
   "notifications.manage"
  ]
 },
 {
  "t": "notification_campaigns",
  "select": [
   "notifications.view"
  ],
  "insert": [
   "notifications.manage"
  ],
  "update": [
   "notifications.manage"
  ]
 },
 {
  "t": "notification_logs",
  "select": [
   "notifications.view"
  ],
  "insert": [
   "notifications.manage"
  ],
  "update": [
   "notifications.manage"
  ]
 },
 {
  "t": "announcements",
  "select": [
   "notifications.view"
  ],
  "insert": [
   "notifications.manage"
  ],
  "update": [
   "notifications.manage"
  ]
 },
 {
  "t": "finance_weekly_reports",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "finance_weekly_cash_counts",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "finance_weekly_momo",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "finance_weekday_collections",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "finance_weekday_cash_counts",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "finance_weekday_momo",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "offering_deposits",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "bank_deposit_settings",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "deposit_alert_settings",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "public_holidays",
  "select": [
   "finance.view"
  ]
 },
 {
  "t": "audit_log",
  "select": [
   "audit.view"
  ]
 }
]$cfg$;
  c jsonb; t text; cmd text; keys text[]; expr text; pname text; sod boolean;
begin
  for c in select value from jsonb_array_elements(cfg) loop
    t := c->>'t';
    if to_regclass('public.' || t) is null then
      raise notice 'Skipping % (table not found in this database)', t;
      continue;
    end if;
    sod := coalesce((c->>'sod')::boolean, false);
    foreach cmd in array array['select','insert','update','delete'] loop
      pname := 'perm_' || cmd || '_' || t;
      execute format('drop policy if exists %I on public.%I', pname, t);   -- only ever drops our own perm_* policy
      keys := array(select jsonb_array_elements_text(coalesce(c -> cmd, '[]'::jsonb)));
      if coalesce(array_length(keys, 1), 0) = 0 then continue; end if;
      select '(' || string_agg(format('(select public.perm_ticked(%L))', k), ' or ') || ')' into expr from unnest(keys) as k;
      if sod and cmd <> 'select' then
        expr := expr || ' and not (select public.perm_ticked(''finance_reviewer.approve''))';
      end if;
      if cmd = 'select' then
        execute format('create policy %I on public.%I for select to authenticated using (%s)', pname, t, expr);
      elsif cmd = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check (%s)', pname, t, expr);
      elsif cmd = 'update' then
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', pname, t, expr, expr);
      else
        execute format('create policy %I on public.%I for delete to authenticated using (%s)', pname, t, expr);
      end if;
    end loop;
  end loop;
end $mig$;
