-- Finance record workflow: draft -> submitted -> approved/locked.
-- Only the Pastor role may approve or authorise reopening. Super Admin is not a financial approver by default.

alter table public.finance_weekly_reports
  add column if not exists approved_at timestamptz,
  add column if not exists reopen_reason text,
  add column if not exists reopened_by_name text,
  add column if not exists reopened_at timestamptz;

alter table public.expenditures
  add column if not exists status text not null default 'Draft',
  add column if not exists approved_by_name text,
  add column if not exists approved_at timestamptz,
  add column if not exists reopen_reason text,
  add column if not exists reopened_by_name text,
  add column if not exists reopened_at timestamptz;

create or replace function public.guard_finance_weekly_report_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    if old.status in ('Submitted','Checked','Approved') then
      raise exception 'Submitted or approved weekly cash reports cannot be deleted.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'Approved' then
      if actor_role is distinct from 'pastor' or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then
        raise exception 'Only the Pastor may authorise reopening an approved report, with a reason.';
      end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then
        raise exception 'Reopening a report cannot change its financial figures. Make corrections after reopening.';
      end if;
    elsif old.status in ('Submitted','Checked') then
      if actor_role is distinct from 'pastor' or new.status not in ('Approved','Reopened') then
        raise exception 'Submitted reports are locked for finance staff until the Pastor approves or reopens them.';
      end if;
      if new.status = 'Reopened' and nullif(trim(new.reopen_reason),'') is null then
        raise exception 'A reason is required to reopen a report.';
      end if;
      if new.status = 'Approved' and (to_jsonb(new) - array['status','approved_by_name','approved_at','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','updated_at']) then
        raise exception 'Approval cannot alter submitted financial figures.';
      end if;
    elsif old.status in ('Draft','Reopened') then
      if new.status = 'Approved' and actor_role is distinct from 'pastor' then
        raise exception 'Only the Pastor may approve a weekly cash report.';
      end if;
      if new.status not in ('Draft','Reopened','Submitted','Approved') then
        raise exception 'Invalid weekly cash report workflow status.';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and new.status = 'Approved' and actor_role is distinct from 'pastor' then
    raise exception 'A weekly cash report must be submitted before the Pastor can approve it.';
  end if;
  return new;
end $$;

drop trigger if exists guard_finance_weekly_report_workflow on public.finance_weekly_reports;
create trigger guard_finance_weekly_report_workflow before insert or update or delete on public.finance_weekly_reports
for each row execute function public.guard_finance_weekly_report_workflow();

create or replace function public.guard_weekly_cash_child_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; report_status text;
begin
  rid := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into report_status from public.finance_weekly_reports where id = rid;
  if report_status is null then raise exception 'Weekly report not found.'; end if;
  if report_status not in ('Draft','Reopened') then raise exception 'Cash-count and MoMo lines are locked after submission. Ask the Pastor to authorise reopening.'; end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists guard_weekly_cash_counts_workflow on public.finance_weekly_cash_counts;
create trigger guard_weekly_cash_counts_workflow before insert or update or delete on public.finance_weekly_cash_counts
for each row execute function public.guard_weekly_cash_child_workflow();
drop trigger if exists guard_weekly_momo_workflow on public.finance_weekly_momo;
create trigger guard_weekly_momo_workflow before insert or update or delete on public.finance_weekly_momo
for each row execute function public.guard_weekly_cash_child_workflow();

create or replace function public.guard_expenditure_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    if old.status in ('Submitted','Approved') then raise exception 'Submitted or approved expenditure cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'Approved' then
      if actor_role is distinct from 'pastor' or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then
        raise exception 'Only the Pastor may authorise reopening approved expenditure, with a reason.';
      end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then
        raise exception 'Reopening expenditure cannot change its financial figures. Make corrections after reopening.';
      end if;
    elsif old.status = 'Submitted' then
      if actor_role is distinct from 'pastor' or new.status not in ('Approved','Reopened') then
        raise exception 'Submitted expenditure is locked pending Pastor approval.';
      end if;
      if new.status = 'Reopened' and nullif(trim(new.reopen_reason),'') is null then raise exception 'A reason is required to reopen expenditure.'; end if;
      if new.status = 'Approved' and (to_jsonb(new) - array['status','approved_by_name','approved_at','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','updated_at']) then raise exception 'Approval cannot alter submitted expenditure figures.'; end if;
    elsif old.status in ('Draft','Reopened') and new.status = 'Approved' and actor_role is distinct from 'pastor' then
      raise exception 'Only the Pastor may approve expenditure.';
    end if;
  elsif tg_op = 'INSERT' and new.status <> 'Draft' then
    raise exception 'New expenditure must begin as a draft.';
  end if;
  return new;
end $$;

drop trigger if exists guard_expenditure_workflow on public.expenditures;
create trigger guard_expenditure_workflow before insert or update or delete on public.expenditures
for each row execute function public.guard_expenditure_workflow();

-- Finance team can prepare and submit records; Pastor may review/approve reports.
-- This does not grant the Super Admin Pastor approval rights.

-- Weekday collections and their denominations/payment references are part of the parent report.
create or replace function public.guard_weekday_collection_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; cid uuid; report_status text;
begin
  if tg_table_name = 'finance_weekday_collections' then
    rid := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  else
    cid := case when tg_op = 'DELETE' then old.collection_id else new.collection_id end;
    select report_id into rid from public.finance_weekday_collections where id = cid;
  end if;
  select status into report_status from public.finance_weekly_reports where id = rid;
  if report_status is null then raise exception 'Weekly report not found.'; end if;
  if report_status not in ('Draft','Reopened') then raise exception 'Weekday collection details are locked after submission. Ask the Pastor to authorise reopening.'; end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists guard_weekday_collection_workflow on public.finance_weekday_collections;
create trigger guard_weekday_collection_workflow before insert or update or delete on public.finance_weekday_collections
for each row execute function public.guard_weekday_collection_workflow();
drop trigger if exists guard_weekday_cash_workflow on public.finance_weekday_cash_counts;
create trigger guard_weekday_cash_workflow before insert or update or delete on public.finance_weekday_cash_counts
for each row execute function public.guard_weekday_collection_workflow();
drop trigger if exists guard_weekday_momo_workflow on public.finance_weekday_momo;
create trigger guard_weekday_momo_workflow before insert or update or delete on public.finance_weekday_momo
for each row execute function public.guard_weekday_collection_workflow();

-- Replace role policies so Pastor can read/review and approve through the app.
drop policy if exists finance_weekly_reports_write on public.finance_weekly_reports;
create policy finance_weekly_reports_write on public.finance_weekly_reports
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'));
drop policy if exists finance_weekly_cash_counts_write on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_write on public.finance_weekly_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'));
drop policy if exists finance_weekly_momo_write on public.finance_weekly_momo;
create policy finance_weekly_momo_write on public.finance_weekly_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'));

-- Existing expenditure policies may be created via the setup script; replace them consistently here.
drop policy if exists expenditures_update on public.expenditures;
create policy expenditures_update on public.expenditures for update to authenticated
using (public.app_role() in ('admin','finance','secretary','pastor'))
with check (public.app_role() in ('admin','finance','secretary','pastor'));
drop policy if exists expenditures_delete on public.expenditures;
create policy expenditures_delete on public.expenditures for delete to authenticated
using (public.app_role() in ('admin','finance','secretary','pastor'));

drop policy if exists finance_weekly_reports_read on public.finance_weekly_reports;
create policy finance_weekly_reports_read on public.finance_weekly_reports for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer','pastor'));
drop policy if exists finance_weekly_cash_counts_read on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_read on public.finance_weekly_cash_counts for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer','pastor'));
drop policy if exists finance_weekly_momo_read on public.finance_weekly_momo;
create policy finance_weekly_momo_read on public.finance_weekly_momo for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer','pastor'));
drop policy if exists expenditures_select on public.expenditures;
create policy expenditures_select on public.expenditures for select to authenticated
using (public.app_role() in ('admin','finance','secretary','viewer','pastor','super_admin'));
