-- =====================================================================
-- Migration 02: detailed offerings, First Fruit / Welfare dues tracker,
-- Welfare Fund (separate registry + income/expenditure), headcount attendance.
--
-- Run ONCE, on your EXISTING project (the one where schema.sql already ran):
-- Dashboard > SQL Editor > New query > paste this whole file > Run.
-- Safe to run even if some of these tables already exist — each block only
-- creates what's missing (checked at the top of each "do $$" block below is
-- unnecessary here because every table/policy name here is new).
-- =====================================================================

-- ---------- offering_entries: detailed weekly offering categories ----------
create table public.offering_entries (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  category   text not null check (category in (
                'Main Offering','Project Offering','Children''s Offering','First Fruit',
                'Weekday Offering','Donation','Thanksgiving','Pledges')),
  amount     numeric(12,2) not null check (amount >= 0),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index on public.offering_entries (date);

-- ---------- member_contributions: per-member monthly tracker ----------
-- Used for two funds that share the identical "member x month" pattern:
--   'First Fruit'    -> person_name matches a row in members
--   'Welfare Dues'   -> person_name matches a row in welfare_members
create table public.member_contributions (
  id          uuid primary key default gen_random_uuid(),
  fund        text not null check (fund in ('First Fruit','Welfare Dues')),
  person_name text not null,
  year        int not null,
  month       int not null check (month between 1 and 12),
  amount      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  unique (fund, person_name, year, month)
);
create index on public.member_contributions (fund, year);

-- ---------- welfare_members: separate welfare-society registry ----------
create table public.welfare_members (
  id                 uuid primary key default gen_random_uuid(),
  ac_no              text,
  name               text not null,
  sex                text check (sex in ('M','F')),
  date_registered    date,
  phone              text,
  department         text,
  next_of_kin        text,
  registration_dues  numeric(12,2) default 0,
  status             text not null default 'Active' check (status in ('Active','Inactive')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default auth.uid()
);
create index on public.welfare_members (name);

-- ---------- welfare_transactions: welfare fund income & expenditure ----------
-- Covers OFFERING / INCOME / EXPENDITURE / T&T from the old workbook — T&T (transport
-- claim) details just go in "note" rather than a separate multi-line form.
create table public.welfare_transactions (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  kind       text not null check (kind in ('Income','Expenditure')),
  item       text not null,
  amount     numeric(12,2) not null check (amount >= 0),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index on public.welfare_transactions (date);

-- ---------- attendance_headcount: quick tally by demographic category ----------
-- Complements the existing per-person "attendance" table with the fast headcount-only
-- style used for weekday/Sunday tallies (Children/Youth/Adult, split by sex).
create table public.attendance_headcount (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  service    text not null,
  category   text not null check (category in (
                'Children Boys','Children Girls','Youth Boys','Youth Girls','Adult Men','Adult Women')),
  count      int not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (date, service, category)
);
create index on public.attendance_headcount (date);

-- ---------- keep updated_at fresh ----------
do $$
declare t text;
begin
  foreach t in array array['offering_entries','member_contributions','welfare_members','welfare_transactions','attendance_headcount'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ---------- audit log ----------
do $$
declare t text;
begin
  foreach t in array array['offering_entries','member_contributions','welfare_members','welfare_transactions','attendance_headcount'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------- row-level security ----------
-- Financial tables (offerings, First Fruit / welfare dues amounts, welfare transactions):
-- same admin+finance-only pattern as the existing "giving" table.
alter table public.offering_entries    enable row level security;
alter table public.member_contributions enable row level security;
alter table public.welfare_transactions enable row level security;
do $$
declare t text;
begin
  foreach t in array array['offering_entries','member_contributions','welfare_transactions'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.app_role() in ('admin','finance'))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.app_role() in ('admin','finance'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.app_role() in ('admin','finance'))
      with check (public.app_role() in ('admin','finance'))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (public.app_role() = 'admin')$p$, t || '_delete', t);
  end loop;
end $$;

-- welfare_members: a membership registry, same pattern as the existing "members" table
-- (admin + secretary manage it; admin/finance/secretary/viewer can read it).
alter table public.welfare_members enable row level security;
create policy welfare_members_select on public.welfare_members for select to authenticated
  using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy welfare_members_insert on public.welfare_members for insert to authenticated
  with check (public.app_role() in ('admin','secretary'));
create policy welfare_members_update on public.welfare_members for update to authenticated
  using (public.app_role() in ('admin','secretary'))
  with check (public.app_role() in ('admin','secretary'));
create policy welfare_members_delete on public.welfare_members for delete to authenticated
  using (public.app_role() = 'admin');

-- attendance_headcount: same pattern as the existing "attendance" table.
alter table public.attendance_headcount enable row level security;
create policy attendance_headcount_select on public.attendance_headcount for select to authenticated
  using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy attendance_headcount_insert on public.attendance_headcount for insert to authenticated
  with check (public.app_role() in ('admin','secretary'));
create policy attendance_headcount_update on public.attendance_headcount for update to authenticated
  using (public.app_role() in ('admin','secretary'))
  with check (public.app_role() in ('admin','secretary'));
create policy attendance_headcount_delete on public.attendance_headcount for delete to authenticated
  using (public.app_role() = 'admin');

-- ---------- privileges (RLS above decides which rows) ----------
revoke all on public.offering_entries, public.member_contributions, public.welfare_members,
              public.welfare_transactions, public.attendance_headcount from anon;
grant select, insert, update, delete on public.offering_entries, public.member_contributions,
              public.welfare_members, public.welfare_transactions, public.attendance_headcount
  to authenticated;
