-- V42: Attendance may be marked only once per person per calendar day.
-- The application enforces this immediately (including offline use). These indexes
-- provide database-level protection for member/child-linked attendance as well.
-- If this migration reports duplicate rows, review those historical records first;
-- do not delete them automatically.

create index if not exists attendance_member_date_idx
  on public.attendance(member_id, date)
  where member_id is not null;

create index if not exists attendance_child_date_idx
  on public.attendance(child_id, date)
  where child_id is not null;

-- Use a constraint trigger rather than a unique index so existing historical duplicates
-- do not block migration. New/updated rows are rejected when a linked person already has
-- an attendance record for the same date under another service/event.
create or replace function public.prevent_duplicate_daily_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.member_id is not null and exists (
    select 1 from public.attendance a
    where a.id <> new.id
      and a.date = new.date
      and a.member_id = new.member_id
  ) then
    raise exception 'Attendance can only be marked once per person per day.' using errcode = '23505';
  end if;

  if new.child_id is not null and exists (
    select 1 from public.attendance a
    where a.id <> new.id
      and a.date = new.date
      and a.child_id = new.child_id
  ) then
    raise exception 'Attendance can only be marked once per child per day.' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_once_per_day on public.attendance;
create trigger attendance_once_per_day
before insert or update on public.attendance
for each row execute function public.prevent_duplicate_daily_attendance();
