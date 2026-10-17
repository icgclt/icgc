-- V65: Offering deposit slips.
--   bank_deposit_settings : the church's bank details, entered once and reused on every slip.
--   offering_deposits     : one deposit slip per weekly finance report, with a
--                           Prepared -> Deposited -> Acknowledged (by the Pastor) trail.
-- Safe to run more than once. Back up first.

-- 1. Bank details (one row per church) ---------------------------------------
create table if not exists public.bank_deposit_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  bank_name text,
  branch text,
  account_type text check (account_type in ('Savings','Current')),
  account_number text,
  account_name text,
  currency text not null default 'GHS',
  default_purpose text,
  depositor_name text,
  depositor_phone text,
  depositor_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- 2. Deposit slips -------------------------------------------------------------
create table if not exists public.offering_deposits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete restrict,
  report_date date not null,
  week_no smallint,
  slip_date date,
  slip jsonb not null default '{}'::jsonb,
  total_cash numeric(14,2) not null default 0,
  withdrawn_amount numeric(14,2) not null default 0,
  cheque_total numeric(14,2) not null default 0,
  total_deposit numeric(14,2) not null default 0,
  bank_name text,
  branch text,
  account_number text,
  account_name text,
  account_type text,
  currency text default 'GHS',
  depositor_name text,
  depositor_phone text,
  depositor_id text,
  purpose text,
  status text not null default 'Prepared' check (status in ('Prepared','Deposited','Acknowledged')),
  prepared_by uuid default auth.uid(),
  prepared_by_name text,
  deposited_at timestamptz,
  deposited_by uuid,
  deposited_by_name text,
  bank_reference text,
  deposit_note text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledgement_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id)
);
create index if not exists offering_deposits_status_idx on public.offering_deposits(status);
create index if not exists offering_deposits_report_date_idx on public.offering_deposits(report_date desc);

-- 3. Row level security --------------------------------------------------------
alter table public.bank_deposit_settings enable row level security;
alter table public.offering_deposits enable row level security;

drop policy if exists bank_deposit_settings_select on public.bank_deposit_settings;
drop policy if exists bank_deposit_settings_insert on public.bank_deposit_settings;
drop policy if exists bank_deposit_settings_update on public.bank_deposit_settings;
create policy bank_deposit_settings_select on public.bank_deposit_settings
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
create policy bank_deposit_settings_insert on public.bank_deposit_settings
  for insert to authenticated
  with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));
create policy bank_deposit_settings_update on public.bank_deposit_settings
  for update to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
  with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists offering_deposits_select on public.offering_deposits;
drop policy if exists offering_deposits_insert on public.offering_deposits;
drop policy if exists offering_deposits_update on public.offering_deposits;
drop policy if exists offering_deposits_delete on public.offering_deposits;
create policy offering_deposits_select on public.offering_deposits
  for select to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'));
create policy offering_deposits_insert on public.offering_deposits
  for insert to authenticated
  with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));
-- The Pastor may update a row, but the guard trigger below limits that to acknowledging a deposit.
create policy offering_deposits_update on public.offering_deposits
  for update to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'))
  with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','pastor'));
-- Only a slip that has not been deposited yet can be deleted.
create policy offering_deposits_delete on public.offering_deposits
  for delete to authenticated
  using (status = 'Prepared' and (select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

-- 4. Guard trigger: who may do what at each stage ------------------------------
create or replace function public.offering_deposits_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
  ignore_keys text[] := array['status','acknowledged_at','acknowledged_by','acknowledged_by_name','acknowledgement_note','updated_at'];
begin
  if auth.uid() is null then
    return new;  -- server-side jobs (backup restore etc.)
  end if;
  select role into actor from public.profiles where id = auth.uid();

  -- Pastor: may only acknowledge a deposit that has been marked Deposited.
  if actor = 'pastor' then
    if old.status <> 'Deposited' or new.status <> 'Acknowledged' then
      raise exception 'The Pastor can only acknowledge a deposit that has been marked as Deposited.';
    end if;
    if (to_jsonb(new) - ignore_keys) is distinct from (to_jsonb(old) - ignore_keys) then
      raise exception 'The Pastor can acknowledge a deposit but cannot change its figures.';
    end if;
    new.acknowledged_by := auth.uid();
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
    return new;
  end if;

  if actor not in ('super_admin','admin','finance') then
    raise exception 'You do not have permission to change deposit slips.';
  end if;

  if new.status = 'Acknowledged' and old.status <> 'Acknowledged' then
    raise exception 'Only the Pastor can acknowledge a deposit.';
  end if;

  if old.status = 'Acknowledged' then
    raise exception 'This deposit has been acknowledged by the Pastor and is locked.';
  end if;

  if old.status = 'Deposited' then
    if new.status = 'Prepared' then
      -- "Marked by mistake": clear the deposit details so it can be redone.
      new.deposited_at := null; new.deposited_by := null; new.deposited_by_name := null;
      new.bank_reference := null; new.deposit_note := null;
      return new;
    end if;
    raise exception 'This slip has been deposited and its figures are locked. Undo the deposit first if it was a mistake.';
  end if;

  if old.status = 'Prepared' and new.status = 'Deposited' then
    if new.deposited_at is null then
      new.deposited_at := now();
    end if;
    new.deposited_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists offering_deposits_guard_trg on public.offering_deposits;
create trigger offering_deposits_guard_trg
  before update on public.offering_deposits
  for each row execute function public.offering_deposits_guard();

-- 5. updated_at + audit --------------------------------------------------------
drop trigger if exists bank_deposit_settings_set_updated_at on public.bank_deposit_settings;
create trigger bank_deposit_settings_set_updated_at
  before update on public.bank_deposit_settings
  for each row execute function public.set_updated_at();

drop trigger if exists offering_deposits_set_updated_at on public.offering_deposits;
create trigger offering_deposits_set_updated_at
  before update on public.offering_deposits
  for each row execute function public.set_updated_at();

do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists bank_deposit_settings_audit on public.bank_deposit_settings;
    create trigger bank_deposit_settings_audit
      after insert or update or delete on public.bank_deposit_settings
      for each row execute function public.audit_row();
    drop trigger if exists offering_deposits_audit on public.offering_deposits;
    create trigger offering_deposits_audit
      after insert or update or delete on public.offering_deposits
      for each row execute function public.audit_row();
  end if;
end $$;
