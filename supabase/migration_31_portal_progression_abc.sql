-- V31: phone-based member portal credentials, lifelong member progression, and ABC Class.

alter table public.members add column if not exists portal_enabled boolean not null default false;
alter table public.members add column if not exists portal_created_at timestamptz;

create table if not exists public.member_group_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  from_group text not null,
  to_group text not null,
  from_member_code text,
  to_member_code text,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists member_group_history_member_idx on public.member_group_history(member_id, changed_at);
alter table public.member_group_history enable row level security;
drop policy if exists member_group_history_select on public.member_group_history;
create policy member_group_history_select on public.member_group_history for select to authenticated using (public.app_role() in ('admin','secretary','finance','viewer') or member_id = (select member_id from public.profiles where id=auth.uid()));
drop policy if exists member_group_history_insert on public.member_group_history;
create policy member_group_history_insert on public.member_group_history for insert to authenticated with check (public.app_role() in ('admin','secretary'));

-- Preserve every historical code when generating the next code; codes are never reused.
create or replace function public.next_member_code(p_member_type text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text := case when p_member_type = 'Child' then 'TTC' when p_member_type = 'Omega' then 'TTO' else 'TTA' end;
  n integer;
  candidate text;
begin
  select greatest(
    coalesce((select max((substring(upper(trim(member_code)) from 4))::integer) from public.members where upper(trim(member_code)) ~ ('^'||prefix||'[0-9]+$')),0),
    coalesce((select max((substring(upper(trim(from_member_code)) from 4))::integer) from public.member_group_history where upper(trim(from_member_code)) ~ ('^'||prefix||'[0-9]+$')),0),
    coalesce((select max((substring(upper(trim(to_member_code)) from 4))::integer) from public.member_group_history where upper(trim(to_member_code)) ~ ('^'||prefix||'[0-9]+$')),0)
  ) + 1 into n;
  candidate := prefix || n;
  while exists (select 1 from public.members where upper(trim(member_code)) = candidate) loop
    n := n + 1; candidate := prefix || n;
  end loop;
  return candidate;
end; $$;
grant execute on function public.next_member_code(text) to authenticated;

-- ABC Class: a temporary Sunday Bible Study class with an individual weekly register.
alter table public.groups add column if not exists start_date date;
alter table public.groups add column if not exists end_date date;
alter table public.groups add column if not exists number_of_weeks integer;

create table if not exists public.abc_class_attendance (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null,
  week_no integer not null,
  present boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique(group_id, member_id, date)
);
create index if not exists abc_class_attendance_date_idx on public.abc_class_attendance(group_id,date);
alter table public.abc_class_attendance enable row level security;
drop policy if exists abc_class_attendance_select on public.abc_class_attendance;
create policy abc_class_attendance_select on public.abc_class_attendance for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
drop policy if exists abc_class_attendance_insert on public.abc_class_attendance;
create policy abc_class_attendance_insert on public.abc_class_attendance for insert to authenticated with check (public.app_role() in ('admin','secretary'));
drop policy if exists abc_class_attendance_update on public.abc_class_attendance;
create policy abc_class_attendance_update on public.abc_class_attendance for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
drop policy if exists abc_class_attendance_delete on public.abc_class_attendance;
create policy abc_class_attendance_delete on public.abc_class_attendance for delete to authenticated using (public.app_role()='admin');


alter table public.follow_ups add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.prayer_requests add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.pastoral_cases add column if not exists member_id uuid references public.members(id) on delete set null;
create index if not exists follow_ups_member_idx on public.follow_ups(member_id);
create index if not exists prayer_requests_member_idx on public.prayer_requests(member_id);
create index if not exists pastoral_cases_member_idx on public.pastoral_cases(member_id);
