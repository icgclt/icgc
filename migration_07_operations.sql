-- V7 operations: department membership, group membership/attendance and volunteer scheduling.
create table if not exists public.department_members (
 id uuid primary key default gen_random_uuid(),
 department_id uuid not null references public.departments(id) on delete cascade,
 member_id uuid not null references public.members(id) on delete cascade,
 role_name text,
 status text not null default 'Active' check(status in ('Active','Inactive')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid default auth.uid(),
 unique(department_id,member_id)
);
create table if not exists public.group_members (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 member_id uuid not null references public.members(id) on delete cascade,
 role_name text,
 status text not null default 'Active' check(status in ('Active','Inactive')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid default auth.uid(),
 unique(group_id,member_id)
);
create table if not exists public.group_attendance (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 date date not null default current_date,
 present_count integer not null default 0,
 visitor_count integer not null default 0,
 topic text,
 notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create table if not exists public.volunteer_schedules (
 id uuid primary key default gen_random_uuid(),
 date date not null,
 service text not null,
 ministry text not null,
 person_id uuid references public.members(id) on delete set null,
 person_name text not null,
 role_name text,
 status text not null default 'Scheduled' check(status in ('Scheduled','Confirmed','Completed','Absent')),
 notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create index if not exists department_members_department_idx on public.department_members(department_id);
create index if not exists group_members_group_idx on public.group_members(group_id);
create index if not exists group_attendance_date_idx on public.group_attendance(group_id,date);
create index if not exists volunteer_schedules_date_idx on public.volunteer_schedules(date,service);

alter table public.department_members enable row level security;
alter table public.group_members enable row level security;
alter table public.group_attendance enable row level security;
alter table public.volunteer_schedules enable row level security;

create policy department_members_select on public.department_members for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy department_members_insert on public.department_members for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy department_members_update on public.department_members for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy department_members_delete on public.department_members for delete to authenticated using (public.app_role()='admin');
create policy group_members_select on public.group_members for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy group_members_insert on public.group_members for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy group_members_update on public.group_members for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy group_members_delete on public.group_members for delete to authenticated using (public.app_role()='admin');
create policy group_attendance_select on public.group_attendance for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy group_attendance_insert on public.group_attendance for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy group_attendance_update on public.group_attendance for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy group_attendance_delete on public.group_attendance for delete to authenticated using (public.app_role()='admin');
create policy volunteer_schedules_select on public.volunteer_schedules for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy volunteer_schedules_insert on public.volunteer_schedules for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy volunteer_schedules_update on public.volunteer_schedules for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy volunteer_schedules_delete on public.volunteer_schedules for delete to authenticated using (public.app_role()='admin');
