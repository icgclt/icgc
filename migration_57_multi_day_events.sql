-- V57: multi-day programmes. The Events screen saves recurrence = 'multi_day' and a duration_days value,
-- but the database only allowed 'none' and 'weekly' and had no duration_days column, so every save failed.

alter table public.events add column if not exists duration_days integer not null default 1;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.events'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%recurrence = any%'
  loop
    execute format('alter table public.events drop constraint %I', r.conname);
  end loop;
  alter table public.events drop constraint if exists events_recurrence_check;
  alter table public.events add constraint events_recurrence_check check (recurrence in ('none','weekly','multi_day'));
  alter table public.events drop constraint if exists events_duration_days_check;
  alter table public.events add constraint events_duration_days_check check (duration_days between 1 and 60);
end $$;
