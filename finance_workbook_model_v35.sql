-- Church Management v35
-- Finance model based on the church's weekly cash-counting workbook.
-- Attendance is intentionally NOT included here.

create table if not exists public.finance_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  week_no smallint not null check (week_no between 1 and 5),
  year integer not null,
  month smallint not null check (month between 1 and 12),
  status text not null default 'Draft' check (status in ('Draft','Submitted','Checked','Approved')),
  prepared_by_name text,
  checked_by_name text,
  approved_by_name text,
  notes text,
  total_cash numeric(14,2) not null default 0,
  total_momo numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(date, week_no)
);

create table if not exists public.finance_weekly_cash_counts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  category text not null,
  denomination numeric(10,2) not null check (denomination in (200,100,50,20,10,5,2,1,0.5,0.2,0.1)),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, category, denomination)
);

create table if not exists public.finance_weekly_momo (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  category text not null,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  provider text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, category)
);

create index if not exists idx_finance_weekly_reports_year_month on public.finance_weekly_reports(year, month);
create index if not exists idx_finance_weekly_cash_report on public.finance_weekly_cash_counts(report_id);
create index if not exists idx_finance_weekly_momo_report on public.finance_weekly_momo(report_id);

-- Reuse the same lightweight role pattern used elsewhere in the app.
alter table public.finance_weekly_reports enable row level security;
alter table public.finance_weekly_cash_counts enable row level security;
alter table public.finance_weekly_momo enable row level security;

drop policy if exists finance_weekly_reports_read on public.finance_weekly_reports;
create policy finance_weekly_reports_read on public.finance_weekly_reports
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_reports_write on public.finance_weekly_reports;
create policy finance_weekly_reports_write on public.finance_weekly_reports
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekly_cash_counts_read on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_read on public.finance_weekly_cash_counts
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_cash_counts_write on public.finance_weekly_cash_counts;
create policy finance_weekly_cash_counts_write on public.finance_weekly_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekly_momo_read on public.finance_weekly_momo;
create policy finance_weekly_momo_read on public.finance_weekly_momo
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekly_momo_write on public.finance_weekly_momo;
create policy finance_weekly_momo_write on public.finance_weekly_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));
