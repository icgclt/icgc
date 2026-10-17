-- V19: Branch and Ministry Intelligence
-- Adds branch ownership to finance records so branch dashboards can report finance activity.

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='giving' and column_name='branch_id') then
    alter table public.giving add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='offering_entries' and column_name='branch_id') then
    alter table public.offering_entries add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='member_contributions' and column_name='branch_id') then
    alter table public.member_contributions add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='payment_receipts' and column_name='branch_id') then
    alter table public.payment_receipts add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='follow_ups' and column_name='branch_id') then
    alter table public.follow_ups add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='prayer_requests' and column_name='branch_id') then
    alter table public.prayer_requests add column branch_id uuid references public.branches(id);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='volunteers' and column_name='branch_id') then
    alter table public.volunteers add column branch_id uuid references public.branches(id);
  end if;
end $$;

create index if not exists giving_branch_id_idx on public.giving(branch_id);
create index if not exists offering_entries_branch_id_idx on public.offering_entries(branch_id);
create index if not exists member_contributions_branch_id_idx on public.member_contributions(branch_id);
create index if not exists payment_receipts_branch_id_idx on public.payment_receipts(branch_id);
create index if not exists follow_ups_branch_id_idx on public.follow_ups(branch_id);
create index if not exists prayer_requests_branch_id_idx on public.prayer_requests(branch_id);
create index if not exists volunteers_branch_id_idx on public.volunteers(branch_id);

-- Existing RLS policies remain unchanged. branch_id is nullable so existing records continue to work.
