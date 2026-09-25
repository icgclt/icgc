-- V25: manual member IDs and Children Department quick attendance
-- Existing member IDs are preserved. New IDs are entered by administrators.

alter table public.attendance add column if not exists child_id uuid references public.children(id) on delete set null;
create index if not exists attendance_child_id_idx on public.attendance(child_id);

-- Prevent duplicate member IDs at database level.
create unique index if not exists members_member_code_unique_idx
  on public.members (lower(trim(member_code)))
  where member_code is not null and trim(member_code) <> '';
