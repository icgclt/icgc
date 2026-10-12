-- Finance v36: Weekday Offering is collected on separate days.
-- Each real collection (Tuesday, Thursday, or a special-program day) is stored separately.
-- Apply this migration before using the updated Finance Center.

create table if not exists public.finance_weekday_collections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.finance_weekly_reports(id) on delete cascade,
  collection_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_weekday_cash_counts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.finance_weekday_collections(id) on delete cascade,
  denomination numeric(10,2) not null check (denomination in (200,100,50,20,10,5,2,1,0.5,0.2,0.1)),
  quantity integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(collection_id, denomination)
);

create table if not exists public.finance_weekday_momo (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.finance_weekday_collections(id) on delete cascade,
  amount numeric(14,2) not null default 0 check (amount >= 0),
  provider text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(collection_id)
);

create index if not exists idx_finance_weekday_collections_report on public.finance_weekday_collections(report_id);
create index if not exists idx_finance_weekday_collections_date on public.finance_weekday_collections(collection_date);
create index if not exists idx_finance_weekday_cash_collection on public.finance_weekday_cash_counts(collection_id);
create index if not exists idx_finance_weekday_momo_collection on public.finance_weekday_momo(collection_id);

alter table public.finance_weekday_collections enable row level security;
alter table public.finance_weekday_cash_counts enable row level security;
alter table public.finance_weekday_momo enable row level security;

drop policy if exists finance_weekday_collections_read on public.finance_weekday_collections;
create policy finance_weekday_collections_read on public.finance_weekday_collections
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_collections_write on public.finance_weekday_collections;
create policy finance_weekday_collections_write on public.finance_weekday_collections
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekday_cash_counts_read on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_read on public.finance_weekday_cash_counts
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_cash_counts_write on public.finance_weekday_cash_counts;
create policy finance_weekday_cash_counts_write on public.finance_weekday_cash_counts
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));

drop policy if exists finance_weekday_momo_read on public.finance_weekday_momo;
create policy finance_weekday_momo_read on public.finance_weekday_momo
for select to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance','secretary','viewer'));

drop policy if exists finance_weekday_momo_write on public.finance_weekday_momo;
create policy finance_weekday_momo_write on public.finance_weekday_momo
for all to authenticated
using ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'))
with check ((select role from public.profiles where id = auth.uid()) in ('super_admin','admin','finance'));
