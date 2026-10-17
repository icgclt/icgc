-- V55: the Cashbook table. The app has always read and written public.cashbook_entries,
-- but no earlier SQL file created it. Safe to run on a database that already has the table.

create table if not exists public.cashbook_entries (
  id uuid primary key,
  entry_date date not null,
  entry_type text not null check (entry_type in ('Opening','Receipt','Payment')),
  description text not null default '',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  payee text,
  pv_no text,
  receipt_no text,
  cheque_no text,
  source_type text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table was created by hand earlier, make sure every column the app uses is there.
alter table public.cashbook_entries add column if not exists entry_date date;
alter table public.cashbook_entries add column if not exists entry_type text;
alter table public.cashbook_entries add column if not exists description text default '';
alter table public.cashbook_entries add column if not exists amount numeric(14,2) default 0;
alter table public.cashbook_entries add column if not exists payee text;
alter table public.cashbook_entries add column if not exists pv_no text;
alter table public.cashbook_entries add column if not exists receipt_no text;
alter table public.cashbook_entries add column if not exists cheque_no text;
alter table public.cashbook_entries add column if not exists source_type text;
alter table public.cashbook_entries add column if not exists source_id text;
alter table public.cashbook_entries add column if not exists created_by uuid references auth.users(id);
alter table public.cashbook_entries add column if not exists created_at timestamptz not null default now();
alter table public.cashbook_entries add column if not exists updated_at timestamptz not null default now();

create index if not exists cashbook_entries_date_idx on public.cashbook_entries(entry_date);
create index if not exists cashbook_entries_updated_at_idx on public.cashbook_entries(updated_at);

-- One opening balance per year, even if two devices save at the same time.
do $$
begin
  create unique index if not exists cashbook_one_opening_per_year
    on public.cashbook_entries ((extract(year from entry_date)::int))
    where entry_type = 'Opening';
exception when others then
  raise notice 'Could not create the one-opening-per-year index (existing duplicate Opening rows?): %', sqlerrm;
end $$;

alter table public.cashbook_entries enable row level security;

drop policy if exists cashbook_entries_select on public.cashbook_entries;
drop policy if exists cashbook_entries_insert on public.cashbook_entries;
drop policy if exists cashbook_entries_update on public.cashbook_entries;
drop policy if exists cashbook_entries_delete on public.cashbook_entries;

create policy cashbook_entries_select on public.cashbook_entries
  for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy cashbook_entries_insert on public.cashbook_entries
  for insert to authenticated with check (public.app_role() in ('admin','finance','secretary'));
create policy cashbook_entries_update on public.cashbook_entries
  for update to authenticated
  using (public.app_role() in ('admin','finance','secretary'))
  with check (public.app_role() in ('admin','finance','secretary'));
create policy cashbook_entries_delete on public.cashbook_entries
  for delete to authenticated using (public.app_role() = 'admin');

drop trigger if exists cashbook_entries_set_updated_at on public.cashbook_entries;
create trigger cashbook_entries_set_updated_at
  before update on public.cashbook_entries
  for each row execute function public.set_updated_at();

-- Money tables belong in the audit log (expenditures is already covered by migration 54).
do $$
begin
  if to_regprocedure('public.audit_row()') is not null then
    drop trigger if exists cashbook_entries_audit on public.cashbook_entries;
    create trigger cashbook_entries_audit
      after insert or update or delete on public.cashbook_entries
      for each row execute function public.audit_row();
  end if;
end $$;
