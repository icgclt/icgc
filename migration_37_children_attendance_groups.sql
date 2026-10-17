-- V37: children's attendance groups/classes
-- Stores a lightweight group/class label on each child for quick attendance.
-- Existing children remain safe and appear under Unassigned until assigned.

alter table public.children
  add column if not exists attendance_group text;

create index if not exists children_attendance_group_idx
  on public.children(attendance_group);
