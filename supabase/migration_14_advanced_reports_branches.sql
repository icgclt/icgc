-- V14: branch foundation and reporting support
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  city text,
  phone text,
  address text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.branches enable row level security;
create policy "branches read authenticated" on public.branches for select to authenticated using (true);
create policy "branches admin write" on public.branches for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Optional branch references. Existing records remain valid with NULL until assigned.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='branch_id') then
    alter table public.profiles add column branch_id uuid references public.branches(id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='branch_id') then alter table public.members add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='branch_id') then alter table public.events add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='departments' and column_name='branch_id') then alter table public.departments add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='groups' and column_name='branch_id') then alter table public.groups add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attendance' and column_name='branch_id') then alter table public.attendance add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='visitors' and column_name='branch_id') then alter table public.visitors add column branch_id uuid references public.branches(id); end if;
end $$;

create index if not exists members_branch_id_idx on public.members(branch_id);
create index if not exists events_branch_id_idx on public.events(branch_id);
create index if not exists attendance_branch_id_idx on public.attendance(branch_id);
create index if not exists visitors_branch_id_idx on public.visitors(branch_id);
