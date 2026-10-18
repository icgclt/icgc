-- =====================================================================================
-- ICGC Dominion Temple setup - PART 2 of 10
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_06_family_children.sql
-- Family, children and secure child check-in.
-- Run after migration_05_member_portal.sql.

alter table public.members add column if not exists family_id uuid;
alter table public.members add column if not exists photo_url text;
alter table public.members add column if not exists baptism_date date;

create table if not exists public.families (
 id uuid primary key default gen_random_uuid(),
 family_name text not null,
 address text,
 phone text,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);

alter table public.members drop constraint if exists members_family_id_fkey;
alter table public.members add constraint members_family_id_fkey foreign key (family_id) references public.families(id) on delete set null;

create table if not exists public.children (
 id uuid primary key default gen_random_uuid(),
 member_id uuid references public.members(id) on delete set null,
 family_id uuid references public.families(id) on delete set null,
 name text not null,
 dob date,
 gender text,
 guardian_name text,
 guardian_phone text,
 pickup_notes text,
 medical_notes text,
 status text not null default 'Active' check(status in ('Active','Inactive')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);

create table if not exists public.child_checkins (
 id uuid primary key default gen_random_uuid(),
 child_id uuid not null references public.children(id) on delete cascade,
 date date not null default current_date,
 service text not null default 'Sunday Service',
 check_in timestamptz not null default now(),
 check_out timestamptz,
 pickup_by text,
 pickup_code text,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);

create index if not exists children_family_idx on public.children(family_id);
create index if not exists child_checkins_child_date_idx on public.child_checkins(child_id,date);

alter table public.families enable row level security;
alter table public.children enable row level security;
alter table public.child_checkins enable row level security;

create policy families_select on public.families for select to authenticated using (public.app_role() in ('admin','secretary','viewer','finance'));
create policy families_insert on public.families for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy families_update on public.families for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy families_delete on public.families for delete to authenticated using (public.app_role() = 'admin');

create policy children_select on public.children for select to authenticated using (public.app_role() in ('admin','secretary','viewer'));
create policy children_insert on public.children for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy children_update on public.children for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy children_delete on public.children for delete to authenticated using (public.app_role() = 'admin');

create policy child_checkins_select on public.child_checkins for select to authenticated using (public.app_role() in ('admin','secretary','viewer'));
create policy child_checkins_insert on public.child_checkins for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy child_checkins_update on public.child_checkins for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy child_checkins_delete on public.child_checkins for delete to authenticated using (public.app_role() = 'admin');

-- Stable child pickup codes. These are operational identifiers, not passwords.
update public.children set guardian_name = coalesce(guardian_name,'') where guardian_name is null;

-- >>> FILE: migration_07_operations.sql
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

-- >>> FILE: migration_08_recurring_events.sql
-- V8 recurring events. Weekly series are materialized as individual event rows so
-- attendance and event registration continue to work with the existing event_id FK.
alter table public.events add column if not exists recurrence text not null default 'none' check (recurrence in ('none','weekly'));
alter table public.events add column if not exists recurrence_end_date date;
alter table public.events add column if not exists series_id uuid;
create index if not exists events_series_idx on public.events(series_id);
create index if not exists events_recurrence_idx on public.events(recurrence,date);

-- >>> FILE: migration_09_event_attendance.sql
-- V9 event-occurrence attendance. Each event occurrence gets its own attendance records.
alter table public.attendance add column if not exists event_id uuid references public.events(id) on delete cascade;
create index if not exists attendance_event_id_idx on public.attendance(event_id);
create unique index if not exists attendance_event_member_unique
  on public.attendance(event_id, member_id)
  where event_id is not null and member_id is not null;

-- >>> FILE: migration_10_service_timer.sql
-- V10: Service timer does not require a database table.
-- Timer programmes are stored locally on the service operator's device.
-- Event-series attendance reporting uses the existing events and attendance tables.
-- No SQL changes are required for this feature.

-- >>> FILE: migration_11_major_modules.sql
-- V11: Finance pledges, communication announcements, pastoral dashboard support
create table if not exists public.pledges (
  id uuid primary key default gen_random_uuid(),
  member_name text not null,
  project text not null,
  pledged_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  currency text not null default 'GHS',
  pledge_date date default current_date,
  due_date date,
  status text not null default 'Open' check (status in ('Open','Part-paid','Paid','Cancelled')),
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.announcements add column if not exists publish_date date;
alter table public.announcements add column if not exists expires_date date;
alter table public.announcements add column if not exists status text not null default 'Published';
alter table public.announcements add column if not exists audience text not null default 'All Members';

alter table public.pledges enable row level security;

drop policy if exists "pledges read" on public.pledges;
drop policy if exists "pledges write" on public.pledges;
drop policy if exists "pledges delete" on public.pledges;
create policy "pledges read" on public.pledges for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));
create policy "pledges write" on public.pledges for insert with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));
create policy "pledges update" on public.pledges for update using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));
create policy "pledges delete" on public.pledges for delete using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));

create index if not exists pledges_project_idx on public.pledges(project);
create index if not exists pledges_member_idx on public.pledges(member_name);
create index if not exists announcements_publish_idx on public.announcements(publish_date);

-- >>> FILE: migration_12_member_engagement.sql
-- V12: Member giving, digital receipts, communication templates and automation queue
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  amount numeric(14,2) not null default 0,
  fund text not null default 'Offering',
  method text not null default 'Mobile Money',
  provider text,
  reference text,
  status text not null default 'Paid' check (status in ('Pending','Paid','Failed','Refunded')),
  receipt_number text unique,
  paid_at timestamptz default now(),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'SMS' check (channel in ('SMS','WhatsApp','Email','In-app')),
  audience text not null default 'All Members',
  subject text,
  body text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_queue (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  member_name text,
  phone text,
  channel text not null default 'SMS',
  template_id uuid references public.communication_templates(id) on delete set null,
  trigger_type text not null default 'Manual',
  scheduled_for timestamptz,
  status text not null default 'Queued' check (status in ('Queued','Sent','Failed','Cancelled')),
  message text,
  provider_reference text,
  sent_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_receipts enable row level security;
alter table public.communication_templates enable row level security;
alter table public.communication_queue enable row level security;

drop policy if exists "payment receipts read" on public.payment_receipts;
drop policy if exists "payment receipts write" on public.payment_receipts;
create policy "payment receipts read" on public.payment_receipts for select using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance','secretary')));
create policy "payment receipts write" on public.payment_receipts for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));

drop policy if exists "communication templates access" on public.communication_templates;
create policy "communication templates access" on public.communication_templates for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','secretary'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','secretary')));

drop policy if exists "communication queue access" on public.communication_queue;
create policy "communication queue access" on public.communication_queue for all using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','secretary'))) with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','secretary')));

create index if not exists payment_receipts_member_idx on public.payment_receipts(member_id);
create index if not exists payment_receipts_paid_idx on public.payment_receipts(paid_at);
create index if not exists communication_queue_status_idx on public.communication_queue(status, scheduled_for);

-- >>> FILE: migration_13_finance_automation.sql
-- V13: finance reconciliation and automation support
create table if not exists public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  method_filter text not null default 'All',
  system_amount numeric(14,2) not null default 0,
  counted_amount numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  status text not null default 'Needs Review' check (status in ('Balanced','Needs Review')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(date, method_filter)
);

alter table public.finance_reconciliations enable row level security;
drop policy if exists "finance reconciliation access" on public.finance_reconciliations;
create policy "finance reconciliation access" on public.finance_reconciliations for all
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')))
with check (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','finance')));

create index if not exists finance_reconciliation_date_idx on public.finance_reconciliations(date);
