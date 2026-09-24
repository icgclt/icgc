-- V20: Branch Assignment & Management
-- Ensures all core records used by branch operations can safely carry a branch assignment.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='families' and column_name='branch_id') then alter table public.families add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='children' and column_name='branch_id') then alter table public.children add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='child_checkins' and column_name='branch_id') then alter table public.child_checkins add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='pledges' and column_name='branch_id') then alter table public.pledges add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='payment_requests' and column_name='branch_id') then alter table public.payment_requests add column branch_id uuid references public.branches(id); end if;
end $$;

create index if not exists families_branch_id_idx on public.families(branch_id);
create index if not exists children_branch_id_idx on public.children(branch_id);
create index if not exists child_checkins_branch_id_idx on public.child_checkins(branch_id);
create index if not exists pledges_branch_id_idx on public.pledges(branch_id);
create index if not exists payment_requests_branch_id_idx on public.payment_requests(branch_id);

-- Assignment is performed through the admin-only Branch Assignment page. Existing RLS remains in force.
