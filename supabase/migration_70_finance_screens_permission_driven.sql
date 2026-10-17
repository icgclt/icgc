-- V70: Reconciliation and Cashbook follow Role Permissions (database side).
-- Run once in the Supabase SQL editor for EACH church (DT and TT). Safe to re-run.
-- Needs nothing else first: it (re)creates the has_permission() helper that migration 69 also creates.
--
-- Before: the database accepted Reconciliation only for people whose role was literally 'admin' or 'finance', and
--         Cashbook only for the admin / finance / secretary / viewer templates. Ticking the boxes under
--         Role Permissions opened nothing for any other group (for example Finance Reviewer or a custom group).
-- After:  a group is also accepted when its Role Permissions are ticked:
--           Reconciliation  -> view: "View Reconciliation" or "Manage Reconciliation"; change: "Manage Reconciliation"
--           Cashbook        -> view: "View Finance" or "Manage Finance";                change: "Manage Finance"
--         Nobody who could use these before loses access.
-- Unchanged on purpose:
--   * The Pastor and Finance Reviewer still cannot change money tables (migration 56 blocks it for them whatever is ticked).
--   * A group that is allowed to Review & Approve can never change these tables through the permission route
--     (separation of duties: people who prepare must not also approve).
--   * Deleting Cashbook entries stays Admin only.

create or replace function public.has_permission(p_key text)
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
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------- Reconciliation
drop policy if exists "finance reconciliation access" on public.finance_reconciliations;
drop policy if exists finance_reconciliations_select on public.finance_reconciliations;
drop policy if exists finance_reconciliations_insert on public.finance_reconciliations;
drop policy if exists finance_reconciliations_update on public.finance_reconciliations;
drop policy if exists finance_reconciliations_delete on public.finance_reconciliations;

create policy finance_reconciliations_select on public.finance_reconciliations
  for select to authenticated
  using (public.app_role() in ('admin','finance')
         or public.has_permission('finance_reconciliation.view')
         or public.has_permission('finance_reconciliation.manage'));

create policy finance_reconciliations_insert on public.finance_reconciliations
  for insert to authenticated
  with check (public.app_role() in ('admin','finance')
              or (public.has_permission('finance_reconciliation.manage') and not public.has_permission('finance_reviewer.approve')));

create policy finance_reconciliations_update on public.finance_reconciliations
  for update to authenticated
  using (public.app_role() in ('admin','finance')
         or (public.has_permission('finance_reconciliation.manage') and not public.has_permission('finance_reviewer.approve')))
  with check (public.app_role() in ('admin','finance')
              or (public.has_permission('finance_reconciliation.manage') and not public.has_permission('finance_reviewer.approve')));

create policy finance_reconciliations_delete on public.finance_reconciliations
  for delete to authenticated
  using (public.app_role() in ('admin','finance')
         or (public.has_permission('finance_reconciliation.manage') and not public.has_permission('finance_reviewer.approve')));

-- ---------------------------------------------------------------- Cashbook
drop policy if exists cashbook_entries_select on public.cashbook_entries;
drop policy if exists cashbook_entries_insert on public.cashbook_entries;
drop policy if exists cashbook_entries_update on public.cashbook_entries;

create policy cashbook_entries_select on public.cashbook_entries
  for select to authenticated
  using (public.app_role() in ('admin','finance','secretary','viewer')
         or public.has_permission('finance.view')
         or public.has_permission('finance.manage'));

create policy cashbook_entries_insert on public.cashbook_entries
  for insert to authenticated
  with check (public.app_role() in ('admin','finance','secretary')
              or (public.has_permission('finance.manage') and not public.has_permission('finance_reviewer.approve')));

create policy cashbook_entries_update on public.cashbook_entries
  for update to authenticated
  using (public.app_role() in ('admin','finance','secretary')
         or (public.has_permission('finance.manage') and not public.has_permission('finance_reviewer.approve')))
  with check (public.app_role() in ('admin','finance','secretary')
              or (public.has_permission('finance.manage') and not public.has_permission('finance_reviewer.approve')));
-- cashbook_entries_delete is left as it was (Admin only).
