-- V8 recurring events. Weekly series are materialized as individual event rows so
-- attendance and event registration continue to work with the existing event_id FK.
alter table public.events add column if not exists recurrence text not null default 'none' check (recurrence in ('none','weekly'));
alter table public.events add column if not exists recurrence_end_date date;
alter table public.events add column if not exists series_id uuid;
create index if not exists events_series_idx on public.events(series_id);
create index if not exists events_recurrence_idx on public.events(recurrence,date);
