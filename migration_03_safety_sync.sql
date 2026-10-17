-- =====================================================================
-- Migration 03: attendance integrity + safer optimistic synchronization.
-- Run on an EXISTING project after schema.sql and migration_02_finance_welfare.sql.
-- =====================================================================

-- Remove exact duplicate attendance rows before adding the constraint.
-- The newest row is retained; if your existing data contains intentional duplicates,
-- review them before running this migration.
with ranked as (
  select id,
         row_number() over (
           partition by date, service, lower(trim(person_name))
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as rn
  from public.attendance
)
delete from public.attendance a
using ranked r
where a.id = r.id and r.rn > 1;

create unique index if not exists attendance_date_service_person_unique
  on public.attendance (date, service, lower(trim(person_name)));

-- Helpful indexes for the queries used by the app.
create index if not exists attendance_service_date_idx
  on public.attendance (service, date desc);
create index if not exists members_status_idx
  on public.members (status);
create index if not exists giving_date_idx
  on public.giving (date desc);
create index if not exists offering_entries_date_idx
  on public.offering_entries (date desc);
create index if not exists welfare_transactions_date_idx
  on public.welfare_transactions (date desc);
