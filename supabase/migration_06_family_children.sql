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
