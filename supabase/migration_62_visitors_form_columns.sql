-- Migration 62: make public.visitors match the Visitors form in the app.
--
-- Problem: the app sends  email, visit_type, source, status  when you save a visitor,
-- but the table only had  follow_up_status, invited_by, prayer_request, assigned_to.
-- Supabase rejected every insert ("Could not find the 'email' column ..."), so the
-- visitor only existed on the device until the next sync, then disappeared.
--
-- Safe to run more than once. Existing columns and data are not touched.

alter table public.visitors
  add column if not exists email      text,
  add column if not exists visit_type text not null default 'First Visit',
  add column if not exists source     text,
  add column if not exists status     text not null default 'New';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visitors_status_check') then
    alter table public.visitors
      add constraint visitors_status_check
      check (status in ('New','Contacted','Connected','Not Connected','Member'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visitors_visit_type_check') then
    alter table public.visitors
      add constraint visitors_visit_type_check
      check (visit_type in ('First Visit','Returning Visitor','Special Service','Event','Other'));
  end if;
end $$;

create index if not exists visitors_status_col_idx on public.visitors (status);

-- Make the API pick up the new columns immediately.
notify pgrst, 'reload schema';
