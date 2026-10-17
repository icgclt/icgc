-- V13: finance reconciliation and automation support
create table if not exists public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  method_filter text not null default 'All',
  system_amount numeric(14,2) not null default 0,
  counted_amount numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  status text not null default 'Needs Review' check (status in ('Balanced','Needs Review')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, method_filter)
);

alter table public.finance_reconciliations enable row level security;
drop policy if exists "finance reconciliation access" on public.finance_reconciliations;
create policy "finance reconciliation access" on public.finance_reconciliations for all
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));

create index if not exists finance_reconciliation_date_idx on public.finance_reconciliations(date);
