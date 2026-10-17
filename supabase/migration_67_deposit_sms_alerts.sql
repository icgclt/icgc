-- V67: Deposit serial number + SMS alerts to the Pastor and the Finance Reviewer.
--   * "I have deposited this money" now needs the serial number printed on the bank's deposit form.
--   * When a deposit is marked as made, an SMS (with the serial number) is queued for the Pastor and the Finance Reviewer.
--   * Every day at 12:00 noon (Ghana time) an SMS is queued for the same two roles for each Sunday offering that has not been
--     deposited, starting on the due day: the next working day after the Sunday (Saturdays, Sundays and the public holidays
--     you list in the app are skipped).
--   * Messages are placed in the existing SMS queue and sent by the notification-worker function, so the SMS provider and the
--     worker schedule must already be set up (see the Delivery Center screen).
-- Alerts are OFF until someone switches them on in Finance -> Deposit Slip -> Deposit SMS alerts.
-- Needs migration 65. Safe to run more than once. Back up first.

-- 1. Serial number on the deposit form ------------------------------------------
alter table public.offering_deposits add column if not exists slip_serial_no text;
alter table public.offering_deposits drop constraint if exists offering_deposits_serial_required;
alter table public.offering_deposits add constraint offering_deposits_serial_required
  check (status = 'Prepared' or length(trim(coalesce(slip_serial_no, ''))) > 0) not valid;

-- 2. Alert settings (one row) and public holidays -------------------------------
create table if not exists public.deposit_alert_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  alerts_enabled boolean not null default false,
  church_label text not null default 'ICGC TT',
  start_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.deposit_alert_settings (singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deposit_alert_settings enable row level security;
alter table public.public_holidays enable row level security;
do $$
declare t text;
begin
  foreach t in array array['deposit_alert_settings', 'public_holidays'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for select to authenticated using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','finance_reviewer','pastor'))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance')) with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))$p$, t || '_update', t);
  end loop;
end $$;
create policy public_holidays_delete on public.public_holidays for delete to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop trigger if exists deposit_alert_settings_set_updated_at on public.deposit_alert_settings;
create trigger deposit_alert_settings_set_updated_at before update on public.deposit_alert_settings
  for each row execute function public.set_updated_at();
drop trigger if exists public_holidays_set_updated_at on public.public_holidays;
create trigger public_holidays_set_updated_at before update on public.public_holidays
  for each row execute function public.set_updated_at();

-- 3. Helpers ---------------------------------------------------------------------
-- The next working day after a date: skips Saturdays, Sundays and listed public holidays.
create or replace function public.next_working_day(d date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare x date := d + 1;
begin
  while extract(isodow from x) in (6, 7) or exists (select 1 from public.public_holidays h where h.holiday_date = x) loop
    x := x + 1;
  end loop;
  return x;
end;
$$;

-- The people who get deposit SMS: every Pastor and Finance Reviewer account that is linked to a member with a phone number.
create or replace function public.deposit_alert_recipients()
returns table (member_id uuid, person_name text, phone text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.phone) m.id, coalesce(nullif(p.full_name, ''), m.name), m.phone
  from public.profiles p
  join public.members m on m.id = p.member_id
  where p.role in ('pastor', 'finance_reviewer') and nullif(trim(m.phone), '') is not null
  order by m.phone;
$$;
revoke all on function public.deposit_alert_recipients() from public, anon, authenticated;

-- 4. SMS when a deposit is marked as made -------------------------------------------
create or replace function public.offering_deposit_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  rec record;
  msg text;
begin
  select * into s from public.deposit_alert_settings limit 1;
  if s is null or not s.alerts_enabled then
    return new;
  end if;
  msg := format('%s: Offering of GHS %s for Sunday %s (Week %s) has been DEPOSITED at the bank by %s on %s. Deposit slip serial no: %s.',
    s.church_label,
    to_char(new.total_deposit, 'FM999,999,990.00'),
    to_char(new.report_date, 'DD/MM/YYYY'),
    coalesce(new.week_no::text, ''),
    coalesce(nullif(new.deposited_by_name, ''), 'the depositor'),
    to_char(coalesce(new.deposited_at, now()) at time zone 'Africa/Accra', 'DD/MM/YYYY HH24:MI'),
    coalesce(new.slip_serial_no, ''));
  for rec in select * from public.deposit_alert_recipients() loop
    insert into public.communication_queue (id, member_id, member_name, phone, channel, trigger_type, scheduled_for, status, message, campaign_title)
    values (gen_random_uuid(), rec.member_id, rec.person_name, rec.phone, 'SMS', 'Deposit Made', now(), 'Queued', msg, 'Deposit made ' || new.id::text || ' ' || new.deposited_at::text);
  end loop;
  return new;
end;
$$;

drop trigger if exists offering_deposits_notify_trg on public.offering_deposits;
create trigger offering_deposits_notify_trg
  after update on public.offering_deposits
  for each row
  when (new.status = 'Deposited' and old.status is distinct from 'Deposited')
  execute function public.offering_deposit_notify();

-- 5. Daily noon reminder for offerings not yet deposited -----------------------------
-- A weekly report counts as "offering to be deposited" when it is dated on or after the alert start date, has money in it,
-- is not rejected, and has no deposit marked as made. The first reminder goes out at 12:00 noon on the due day.
create or replace function public.queue_deposit_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  r record;
  rec record;
  today date := (now() at time zone 'Africa/Accra')::date;
  due date;
  amt numeric;
  msg text;
  rkey text;
  n integer := 0;
begin
  select * into s from public.deposit_alert_settings limit 1;
  if s is null or not s.alerts_enabled then
    return 0;
  end if;
  for r in
    select wr.id, wr.date, wr.week_no, wr.grand_total
    from public.finance_weekly_reports wr
    where wr.date >= s.start_date
      and coalesce(wr.grand_total, 0) > 0
      and wr.status <> 'Rejected'
      and not exists (select 1 from public.offering_deposits d where d.report_id = wr.id and d.status in ('Deposited', 'Acknowledged'))
  loop
    due := public.next_working_day(r.date);
    if today < due then
      continue;
    end if;
    select d.total_deposit into amt from public.offering_deposits d where d.report_id = r.id;
    amt := coalesce(amt, r.grand_total);
    msg := format('%s REMINDER: The offering of GHS %s for Sunday %s has NOT been deposited. It was due before 12:00 noon on %s. Please deposit it and record the slip serial no. in the app.',
      s.church_label, to_char(amt, 'FM999,999,990.00'), to_char(r.date, 'DD/MM/YYYY'), to_char(due, 'FMDay DD/MM/YYYY'));
    rkey := 'Deposit reminder ' || r.id::text || ' ' || today::text;
    for rec in select * from public.deposit_alert_recipients() loop
      if not exists (select 1 from public.communication_queue q where q.campaign_title = rkey and q.phone = rec.phone) then
        insert into public.communication_queue (id, member_id, member_name, phone, channel, trigger_type, scheduled_for, status, message, campaign_title)
        values (gen_random_uuid(), rec.member_id, rec.person_name, rec.phone, 'SMS', 'Deposit Reminder', now(), 'Queued', msg, rkey);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end;
$$;
revoke all on function public.queue_deposit_reminders() from public, anon, authenticated;

-- Run every day at 12:00 noon. Ghana is on UTC all year, so the scheduler's clock is Ghana time.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'deposit-reminders-noon') then
      perform cron.unschedule('deposit-reminders-noon');
    end if;
    perform cron.schedule('deposit-reminders-noon', '0 12 * * *', 'select public.queue_deposit_reminders()');
  else
    raise notice 'pg_cron is not enabled: turn it on under Database > Extensions, then run this file again to schedule the noon reminder.';
  end if;
end $$;
