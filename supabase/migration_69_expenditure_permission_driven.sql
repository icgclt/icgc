-- V69: Expenditure access is decided ONLY by Role Permissions (screen and database).
-- Run once in the Supabase SQL editor (staging first if you have one). Safe to re-run.
--
-- Before: the database allowed expenditure entry only for the admin / finance / secretary templates, blocked the Pastor
-- and Finance Reviewer templates from entering it, and allowed approval only for the Finance Reviewer template and
-- reopening only for the Pastor template. None of that could be changed under Role Permissions.
-- After: three permissions decide everything for Expenditure:
--   Manage Expenditure              -> enter, edit, delete drafts, submit
--   Review & Approve Fin. Records   -> approve, return, reject submitted expenditure
--   Authorise Reopening of Expenditure (new) -> reopen locked expenditure, with a reason
-- Super Admin always has every permission. Nothing else is hidden: untick a permission and the access is gone.
--
-- NOT changed by this file: the Finance Center weekly reports and the other finance tables still use their existing
-- rules (see the notes delivered with this patch).

-- 1) One helper that answers "does the signed-in user's group have this permission ticked?"
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

-- 2) The new permission. Today's behaviour is kept: it starts ticked only for the Pastor group
--    (and any custom group built on the Pastor template). Change it any time under Role Permissions.
insert into public.app_permissions (permission_key, module, action, label, description) values
  ('expenditure.reopen', 'expenditure', 'reopen', 'Authorise Reopening of Expenditure',
   'Reopen approved, rejected or submitted expenditure, with a reason. Tick this for whichever group should authorise reopening (for example the Pastor).')
on conflict (permission_key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label, description = excluded.description;

insert into public.role_permissions (role, permission_id, enabled)
select r.role, ap.id,
       (r.role = 'pastor' or exists (select 1 from public.role_catalog rc where rc.role_key = r.role and rc.base_role = 'pastor'))
from (select distinct role from public.role_permissions) r
cross join public.app_permissions ap
where ap.permission_key = 'expenditure.reopen'
on conflict (role, permission_id) do nothing;

-- 3) Expenditure table access follows the permissions.
drop policy if exists expenditures_select on public.expenditures;
create policy expenditures_select on public.expenditures for select to authenticated
using (
  public.has_permission('expenditure.view') or public.has_permission('expenditure.manage')
  or public.has_permission('finance.view') or public.has_permission('finance_reviewer.approve')
  or public.has_permission('expenditure.reopen')
);

drop policy if exists expenditures_insert on public.expenditures;
create policy expenditures_insert on public.expenditures for insert to authenticated
with check (public.has_permission('expenditure.manage'));

drop policy if exists expenditures_update on public.expenditures;
create policy expenditures_update on public.expenditures for update to authenticated
using (public.has_permission('expenditure.manage') or public.has_permission('finance_reviewer.approve') or public.has_permission('expenditure.reopen'))
with check (public.has_permission('expenditure.manage') or public.has_permission('finance_reviewer.approve') or public.has_permission('expenditure.reopen'));

drop policy if exists expenditures_delete on public.expenditures;
create policy expenditures_delete on public.expenditures for delete to authenticated
using (public.has_permission('expenditure.manage'));

-- 4) The workflow rules (same steps as before: Draft -> Submitted -> Approved / Returned / Rejected, Reopened by authority),
--    but each step now asks for a permission instead of a role name.
create or replace function public.guard_expenditure_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not public.has_permission('expenditure.manage') then raise exception 'You do not have the Manage Expenditure permission.'; end if;
    if old.status in ('Submitted','Approved','Rejected') then raise exception 'Submitted, rejected, or approved expenditure cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if not public.has_permission('expenditure.manage') then raise exception 'You do not have the Manage Expenditure permission.'; end if;
    if coalesce(new.status,'Draft') <> 'Draft' then raise exception 'New expenditure must begin as a draft.'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('Approved','Rejected') then
      if not public.has_permission('expenditure.reopen') or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then
        raise exception 'Reopening locked expenditure needs the Authorise Reopening permission and a reason.';
      end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then
        raise exception 'Reopening expenditure cannot change financial figures.';
      end if;
    elsif old.status = 'Submitted' then
      if new.status = 'Approved' then
        if not public.has_permission('finance_reviewer.approve') then raise exception 'You do not have the Review & Approve permission.'; end if;
        if (to_jsonb(new) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) then
          raise exception 'Approval cannot alter submitted expenditure figures.';
        end if;
      elsif new.status in ('Returned','Rejected') then
        if not public.has_permission('finance_reviewer.approve') or nullif(trim(new.review_reason),'') is null then
          raise exception 'Returning or rejecting expenditure needs the Review & Approve permission and a reason.';
        end if;
      elsif new.status = 'Reopened' then
        if not public.has_permission('expenditure.reopen') or nullif(trim(new.reopen_reason),'') is null then
          raise exception 'Reopening submitted expenditure needs the Authorise Reopening permission and a reason.';
        end if;
      else
        raise exception 'Submitted expenditure must be reviewed (approved, returned or rejected) before it changes.';
      end if;
    elsif old.status in ('Draft','Reopened','Returned') or old.status is null then
      if not public.has_permission('expenditure.manage') then raise exception 'You do not have the Manage Expenditure permission.'; end if;
      if new.status = 'Approved' then raise exception 'Expenditure must be submitted before it can be approved.'; end if;
    end if;
  end if;
  return new;
end $$;
