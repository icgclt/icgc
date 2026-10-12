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
