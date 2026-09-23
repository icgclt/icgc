-- Member portal, self-service profile linking, event registration and announcements.
-- Run after migration_04_ministry.sql.

alter table public.profiles add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.members add column if not exists member_code text;
alter table public.members add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.members add column if not exists marital_status text;
alter table public.members add column if not exists occupation text;
alter table public.members add column if not exists emergency_contact text;
alter table public.attendance add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.giving add column if not exists member_id uuid references public.members(id) on delete set null;
alter table public.prayer_requests add column if not exists member_id uuid references public.members(id) on delete set null;

create unique index if not exists members_member_code_unique on public.members(member_code) where member_code is not null;
create unique index if not exists members_user_id_unique on public.members(user_id) where user_id is not null;

create table if not exists public.event_registrations (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id) on delete cascade,
 member_id uuid not null references public.members(id) on delete cascade,
 status text not null default 'Registered' check(status in ('Registered','Attended','Cancelled')),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid(),
 unique(event_id,member_id)
);

create table if not exists public.announcements (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 body text not null,
 audience text not null default 'All',
 active boolean not null default true,
 publish_from date,
 publish_until date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);

alter table public.event_registrations enable row level security;
alter table public.announcements enable row level security;

create policy event_reg_select on public.event_registrations for select to authenticated using (
 public.app_role() in ('admin','finance','secretary','viewer') or member_id = (select member_id from public.profiles where id=auth.uid())
);
create policy event_reg_insert on public.event_registrations for insert to authenticated with check (
 public.app_role() in ('admin','secretary') or member_id = (select member_id from public.profiles where id=auth.uid())
);
create policy event_reg_update on public.event_registrations for update to authenticated using (
 public.app_role() in ('admin','secretary') or member_id = (select member_id from public.profiles where id=auth.uid())
) with check (
 public.app_role() in ('admin','secretary') or member_id = (select member_id from public.profiles where id=auth.uid())
);
create policy event_reg_delete on public.event_registrations for delete to authenticated using (public.app_role() in ('admin','secretary'));

create policy announcements_select on public.announcements for select to authenticated using (active = true or public.app_role() in ('admin','secretary'));
create policy announcements_insert on public.announcements for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy announcements_update on public.announcements for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy announcements_delete on public.announcements for delete to authenticated using (public.app_role() = 'admin');

-- Member role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','finance','secretary','viewer','member','pending'));

-- Members can see and update their own basic profile only.
create policy members_member_select on public.members for select to authenticated using (user_id = auth.uid());
create policy members_member_update on public.members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Members can see their own attendance and giving. Giving is restricted to their own linked records.
create policy attendance_member_select on public.attendance for select to authenticated using (member_id = (select member_id from public.profiles where id=auth.uid()));
create policy giving_member_select on public.giving for select to authenticated using (member_id = (select member_id from public.profiles where id=auth.uid()));
create policy prayer_member_insert on public.prayer_requests for insert to authenticated with check (member_id = (select member_id from public.profiles where id=auth.uid()));
create policy prayer_member_select on public.prayer_requests for select to authenticated using (member_id = (select member_id from public.profiles where id=auth.uid()));

-- Existing member records receive stable codes when missing.
update public.members set member_code = 'M-' || upper(substr(replace(id::text,'-',''),1,8)) where member_code is null;

create policy events_member_select on public.events for select to authenticated using (public.app_role() = 'member');
