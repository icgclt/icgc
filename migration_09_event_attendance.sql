-- V9 event-occurrence attendance. Each event occurrence gets its own attendance records.
alter table public.attendance add column if not exists event_id uuid references public.events(id) on delete cascade;
create index if not exists attendance_event_id_idx on public.attendance(event_id);
create unique index if not exists attendance_event_member_unique
  on public.attendance(event_id, member_id)
  where event_id is not null and member_id is not null;
