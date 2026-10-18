-- =====================================================================================
-- ICGC Dominion Temple setup - PART 8 of 10  (parts 8-10 added to bring Dominion level with Testimony Temple)
-- Run the parts IN ORDER, each in its own new query, AFTER parts 1-7 (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: expenditure_setup.sql
-- Church Expenditure - Step 1
-- Welfare is intentionally NOT referenced by this table.

create table if not exists public.expenditures (
  id uuid primary key,
  date date not null,
  description text not null,
  category text,
  amount numeric(14,2) not null default 0,
  payee text,
  pv_no text,
  payment_reference text,
  payment_method text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenditures_date_idx
  on public.expenditures(date);

create index if not exists expenditures_updated_at_idx
  on public.expenditures(updated_at);

alter table public.expenditures enable row level security;

drop policy if exists expenditures_select on public.expenditures;
drop policy if exists expenditures_insert on public.expenditures;
drop policy if exists expenditures_update on public.expenditures;
drop policy if exists expenditures_delete on public.expenditures;

create policy expenditures_select
on public.expenditures
for select
to authenticated
using (
  public.app_role() in ('admin','finance','secretary','viewer')
);

create policy expenditures_insert
on public.expenditures
for insert
to authenticated
with check (
  public.app_role() in ('admin','finance','secretary')
);

create policy expenditures_update
on public.expenditures
for update
to authenticated
using (
  public.app_role() in ('admin','finance','secretary')
)
with check (
  public.app_role() in ('admin','finance','secretary')
);

create policy expenditures_delete
on public.expenditures
for delete
to authenticated
using (
  public.app_role() = 'admin'
);

drop trigger if exists expenditures_set_updated_at on public.expenditures;

create trigger expenditures_set_updated_at
before update on public.expenditures
for each row
execute function public.set_updated_at();

-- >>> FILE: migration_52_financial_lock_workflow.sql
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

-- >>> FILE: migration_53_finance_reviewer_role.sql
-- V53 finance role split: Finance Reviewer approves submitted records; Pastor alone authorises reopening locked records.
-- Super Admin has no special financial approval/reopening authority by virtue of technical role.

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
      if new.status = 'Reopened' then
        if actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening, with a reason.'; end if;
      elsif new.status = 'Approved' then
        if actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve a submitted report.'; end if;
      else raise exception 'Submitted reports can only be approved by a Finance Reviewer or reopened by the Pastor.'; end if;
      if new.status = 'Approved' and (to_jsonb(new) - array['status','approved_by_name','approved_at','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','updated_at']) then
        raise exception 'Approval cannot alter submitted financial figures.';
      end if;
    elsif old.status in ('Draft','Reopened') then
      if new.status = 'Approved' and actor_role is distinct from 'finance_reviewer' then
        raise exception 'Only a Finance Reviewer may approve a weekly cash report.';
      end if;
      if new.status not in ('Draft','Reopened','Submitted','Approved') then
        raise exception 'Invalid weekly cash report workflow status.';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and new.status = 'Approved' then
    raise exception 'A weekly cash report must be submitted before a Finance Reviewer can approve it.';
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
      if new.status = 'Reopened' then
        if actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening expenditure, with a reason.'; end if;
      elsif new.status = 'Approved' then
        if actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve expenditure.'; end if;
      else raise exception 'Submitted expenditure can only be approved by a Finance Reviewer or reopened by the Pastor.'; end if;
      if new.status = 'Approved' and (to_jsonb(new) - array['status','approved_by_name','approved_at','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','updated_at']) then raise exception 'Approval cannot alter submitted expenditure figures.'; end if;
    elsif old.status in ('Draft','Reopened') and new.status = 'Approved' and actor_role is distinct from 'finance_reviewer' then
      raise exception 'Only a Finance Reviewer may approve expenditure.';
    end if;
  elsif tg_op = 'INSERT' and new.status <> 'Draft' then
    raise exception 'New expenditure must begin as a draft.';
  end if;
  return new;
end $$;

drop trigger if exists guard_expenditure_workflow on public.expenditures;
create trigger guard_expenditure_workflow before insert or update or delete on public.expenditures
for each row execute function public.guard_expenditure_workflow();

-- Finance team prepares/submits; Finance Reviewer approves; Pastor alone authorises reopening locked records.

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
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
drop policy if exists finance_weekly_cash_counts_write on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_write on public.finance_weekly_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
drop policy if exists finance_weekly_momo_write on public.finance_weekly_momo;
create policy finance_weekly_momo_write on public.finance_weekly_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));

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


-- Dedicated Finance Reviewer role and separate Role Permissions checkbox (not nested under Finance).
insert into public.role_catalog(role_key,label,base_role,is_system)
values ('finance_reviewer','Finance Reviewer','finance',true)
on conflict (role_key) do update set label=excluded.label, base_role=excluded.base_role, is_system=excluded.is_system;

insert into public.app_permissions(permission_key,module,action,label,description)
values ('finance_reviewer.approve','finance_reviewer','approve','Review & Approve Financial Records','Review submitted reports and expenditure; approve, return or reject records. This does not authorize reopening locked records.')
on conflict (permission_key) do update set module=excluded.module, action=excluded.action, label=excluded.label, description=excluded.description;

insert into public.role_permissions(role,permission_id,enabled)
select 'finance_reviewer', p.id, true from public.app_permissions p
where p.permission_key in ('finance.view','finance_reviewer.approve')
on conflict (role,permission_id) do update set enabled=true;

-- Pastor is an oversight/viewer role; approval authority remains with Finance Reviewer.
insert into public.role_catalog(role_key,label,base_role,is_system)
values ('pastor','Pastor','finance',true)
on conflict (role_key) do update set label=excluded.label, base_role=excluded.base_role, is_system=excluded.is_system;
insert into public.role_permissions(role,permission_id,enabled)
select 'pastor', p.id, true from public.app_permissions p where p.permission_key = 'finance.view'
on conflict (role,permission_id) do update set enabled=true;

-- >>> FILE: migration_54_finance_review_audit.sql
-- Finance workflow completion: reasoned return/rejection, audit history, and reviewer access.
-- Review this migration and run it only after taking a database backup.

alter table public.finance_weekly_reports
  add column if not exists review_reason text,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz;
alter table public.expenditures
  add column if not exists review_reason text,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz;

create table if not exists public.finance_workflow_audit (
  id bigint generated by default as identity primary key,
  table_name text not null,
  record_id text,
  operation text not null,
  actor_user_id uuid,
  actor_role text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.finance_workflow_audit enable row level security;
drop policy if exists finance_workflow_audit_read on public.finance_workflow_audit;
create policy finance_workflow_audit_read on public.finance_workflow_audit
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('pastor','admin','super_admin','finance_reviewer'));
-- No client insert/update/delete policy: audit entries are written by the trigger only.

create or replace function public.audit_finance_workflow_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  before_json jsonb;
  after_json jsonb;
  record_key text;
  audit_reason text;
  actor_role text;
begin
  if tg_op = 'INSERT' then before_json := null; after_json := to_jsonb(new); record_key := coalesce(after_json->>'id', after_json->>'report_id', after_json->>'collection_id');
  elsif tg_op = 'DELETE' then before_json := to_jsonb(old); after_json := null; record_key := coalesce(before_json->>'id', before_json->>'report_id', before_json->>'collection_id');
  else before_json := to_jsonb(old); after_json := to_jsonb(new); record_key := coalesce(after_json->>'id', before_json->>'id', after_json->>'report_id', before_json->>'report_id', after_json->>'collection_id', before_json->>'collection_id');
  end if;
  select role into actor_role from public.profiles where id = auth.uid();
  audit_reason := coalesce(after_json->>'review_reason', after_json->>'reopen_reason', before_json->>'review_reason', before_json->>'reopen_reason');
  insert into public.finance_workflow_audit(table_name,record_id,operation,actor_user_id,actor_role,before_data,after_data,reason)
  values (tg_table_name,record_key,tg_op,auth.uid(),actor_role,before_json,after_json,audit_reason);
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['finance_weekly_reports','finance_weekly_cash_counts','finance_weekly_momo','finance_weekday_collections','finance_weekday_cash_counts','finance_weekday_momo','expenditures'] loop
    execute format('drop trigger if exists audit_finance_workflow_change on public.%I', t);
    execute format('create trigger audit_finance_workflow_change after insert or update or delete on public.%I for each row execute function public.audit_finance_workflow_change()', t);
  end loop;
end $$;

-- Replace report transition guard with the Finance Reviewer review outcomes.
create or replace function public.guard_finance_weekly_report_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot delete/prep financial records.'; end if;
    if old.status in ('Submitted','Checked','Approved','Rejected') then raise exception 'Submitted, rejected, or approved weekly cash reports cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot create/prep financial records.'; end if;
  if tg_op = 'INSERT' and new.status = 'Approved' then raise exception 'A weekly cash report must be submitted before approval.'; end if;
  if tg_op = 'UPDATE' then
    if old.status in ('Approved','Rejected') then
      if actor_role is distinct from 'pastor' or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening an approved report, with a reason.'; end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then raise exception 'Reopening cannot change financial figures. Make corrections after reopening.'; end if;
    elsif old.status in ('Submitted','Checked') then
      if actor_role is distinct from 'finance_reviewer' then
        if new.status <> 'Reopened' or actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only a Finance Reviewer can review submitted reports; only the Pastor can authorise reopening with a reason.'; end if;
      elsif new.status = 'Approved' then
        if (to_jsonb(new) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) then raise exception 'Approval cannot alter submitted financial figures.'; end if;
      elsif new.status in ('Returned','Rejected') then
        if nullif(trim(new.review_reason),'') is null then raise exception 'A reason is required to return or reject a report.'; end if;
      elsif new.status <> 'Reopened' then raise exception 'Submitted reports can only be approved, returned, rejected, or reopened by an authorised role.';
      end if;
      if new.status = 'Reopened' and (actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null) then raise exception 'Only the Pastor may authorise reopening, with a reason.'; end if;
    elsif old.status in ('Draft','Reopened','Returned') then
      if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot edit/prep financial records.'; end if;
      if new.status = 'Approved' and actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve a weekly cash report.'; end if;
      if new.status not in ('Draft','Reopened','Returned','Submitted','Approved') then raise exception 'Invalid weekly cash report workflow status.'; end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_weekly_cash_child_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; report_status text; actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot edit financial line items.'; end if;
  rid := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into report_status from public.finance_weekly_reports where id = rid;
  if report_status is null then raise exception 'Weekly report not found.'; end if;
  if report_status not in ('Draft','Reopened','Returned') then raise exception 'Cash-count and MoMo lines are locked after submission. Ask the Pastor to authorise reopening.'; end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create or replace function public.guard_weekday_collection_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid; cid uuid; report_status text; actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot edit weekday collection line items.'; end if;
  if tg_table_name = 'finance_weekday_collections' then rid := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  else cid := case when tg_op = 'DELETE' then old.collection_id else new.collection_id end; select report_id into rid from public.finance_weekday_collections where id = cid; end if;
  select status into report_status from public.finance_weekly_reports where id = rid;
  if report_status is null then raise exception 'Weekly report not found.'; end if;
  if report_status not in ('Draft','Reopened','Returned') then raise exception 'Weekday collection details are locked after submission. Ask the Pastor to authorise reopening.'; end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

create or replace function public.guard_expenditure_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot delete/prep financial records.'; end if;
    if old.status in ('Submitted','Approved','Rejected') then raise exception 'Submitted, rejected, or approved expenditure cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot create/prep financial records.'; end if;
  if tg_op = 'INSERT' and coalesce(new.status,'Draft') <> 'Draft' then raise exception 'New expenditure must begin as a draft.'; end if;
  if tg_op = 'UPDATE' then
    if old.status in ('Approved','Rejected') then
      if actor_role is distinct from 'pastor' or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening locked expenditure, with a reason.'; end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then raise exception 'Reopening expenditure cannot change financial figures.'; end if;
    elsif old.status = 'Submitted' then
      if new.status = 'Approved' then
        if actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve expenditure.'; end if;
        if (to_jsonb(new) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) then raise exception 'Approval cannot alter submitted expenditure figures.'; end if;
      elsif new.status in ('Returned','Rejected') then
        if actor_role is distinct from 'finance_reviewer' or nullif(trim(new.review_reason),'') is null then raise exception 'Only a Finance Reviewer may return or reject expenditure, with a reason.'; end if;
      elsif new.status = 'Reopened' then
        if actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening, with a reason.'; end if;
      else raise exception 'Submitted expenditure must be reviewed by a Finance Reviewer.'; end if;
    elsif old.status in ('Draft','Reopened','Returned') then
      if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot edit/prep financial records.'; end if;
      if new.status = 'Approved' and actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve expenditure.'; end if;
    end if;
  end if;
  return new;
end $$;

-- Finance Reviewer needs read/write access to submitted records; triggers enforce allowed transitions.
drop policy if exists expenditures_select on public.expenditures;
create policy expenditures_select on public.expenditures for select to authenticated
using (public.app_role() in ('admin','finance','finance_reviewer','secretary','viewer','pastor','super_admin'));
drop policy if exists expenditures_update on public.expenditures;
create policy expenditures_update on public.expenditures for update to authenticated
using (public.app_role() in ('admin','finance','finance_reviewer','secretary','pastor'))
with check (public.app_role() in ('admin','finance','finance_reviewer','secretary','pastor'));
drop policy if exists expenditures_delete on public.expenditures;
create policy expenditures_delete on public.expenditures for delete to authenticated
using (public.app_role() in ('admin','finance','finance_reviewer','secretary','pastor'));


-- Finance Reviewer and Pastor must be able to read weekly report line items and weekday collections.
drop policy if exists finance_weekly_reports_read on public.finance_weekly_reports;
create policy finance_weekly_reports_read on public.finance_weekly_reports for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));
drop policy if exists finance_weekly_cash_counts_read on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_read on public.finance_weekly_cash_counts for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));
drop policy if exists finance_weekly_momo_read on public.finance_weekly_momo;
create policy finance_weekly_momo_read on public.finance_weekly_momo for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));

drop policy if exists finance_weekday_collections_read on public.finance_weekday_collections;
create policy finance_weekday_collections_read on public.finance_weekday_collections for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));
drop policy if exists finance_weekday_collections_write on public.finance_weekday_collections;
create policy finance_weekday_collections_write on public.finance_weekday_collections for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
drop policy if exists finance_weekday_cash_counts_read on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_read on public.finance_weekday_cash_counts for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));
drop policy if exists finance_weekday_cash_counts_write on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_write on public.finance_weekday_cash_counts for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
drop policy if exists finance_weekday_momo_read on public.finance_weekday_momo;
create policy finance_weekday_momo_read on public.finance_weekday_momo for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','secretary','viewer','pastor'));
drop policy if exists finance_weekday_momo_write on public.finance_weekday_momo;
create policy finance_weekday_momo_write on public.finance_weekday_momo for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));

-- Align weekly cash/momo write policies with the reviewer role (triggers still block prep edits).
drop policy if exists finance_weekly_cash_counts_write on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_write on public.finance_weekly_cash_counts for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
drop policy if exists finance_weekly_momo_write on public.finance_weekly_momo;
create policy finance_weekly_momo_write on public.finance_weekly_momo for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));

-- Ensure dedicated reviewer role can open the finance module without gaining preparer rights.
insert into public.role_permissions(role,permission_id,enabled)
select 'finance_reviewer', p.id, true from public.app_permissions p
where p.permission_key in ('finance.view','finance_reviewer.approve')
on conflict (role,permission_id) do update set enabled=true;
insert into public.role_permissions(role,permission_id,enabled)
select 'pastor', p.id, true from public.app_permissions p
where p.permission_key = 'finance.view'
on conflict (role,permission_id) do update set enabled=true;
insert into public.role_permissions(role,permission_id,enabled)
select 'pastor', p.id, true from public.app_permissions p
where p.permission_key in ('pastoral_cases.view','finance.view')
on conflict (role,permission_id) do update set enabled=true;

