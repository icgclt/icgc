-- V21: Branch-Level Access Control
-- Adds a branch_admin role and restricts branch administrators to their assigned branch.

-- Extend the profile role constraint safely.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check check (role in ('admin','finance','secretary','viewer','branch_admin','member','pending'));

-- Returns the signed-in user's branch without recursively querying profiles through RLS.
create or replace function public.app_branch_id() returns uuid
language sql stable security definer set search_path = public
as $$ select branch_id from public.profiles where id = auth.uid() $$;

revoke all on function public.app_branch_id() from public, anon;
grant execute on function public.app_branch_id() to authenticated;

-- A branch administrator must have a branch assigned.
create or replace function public.branch_admin_has_branch() returns boolean
language sql stable security definer set search_path = public
as $$ select public.app_role() <> 'branch_admin' or public.app_branch_id() is not null $$;

revoke all on function public.branch_admin_has_branch() from public, anon;
grant execute on function public.branch_admin_has_branch() to authenticated;

-- Branch administrators can see the branch directory, but cannot modify branches.
-- The existing branches policies from V14 remain in force for admins.

-- Operational branch-scoped tables.
do $$
declare t text;
begin
  foreach t in array array[
    'members','attendance','attendance_headcount','departments','events','groups','visitors',
    'follow_ups','prayer_requests','volunteers','families','children','child_checkins','pledges','payment_requests'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'branch_admin_select_'||t, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_select_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_insert_'||t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_insert_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_update_'||t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id()) with check (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_update_'||t, t);

    execute format('drop policy if exists %I on public.%I', 'branch_admin_delete_'||t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_delete_'||t, t);
  end loop;
end $$;

-- Finance records are visible to branch administrators for branch reporting,
-- but remain editable only by admin/finance users.
do $$
declare t text;
begin
  foreach t in array array['giving','offering_entries','member_contributions','payment_receipts'] loop
    execute format('drop policy if exists %I on public.%I', 'branch_admin_finance_select_'||t, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_role() = ''branch_admin'' and branch_id = public.app_branch_id())', 'branch_admin_finance_select_'||t, t);
  end loop;
end $$;

-- Profiles: administrators can assign branch_admin and branch_id through the existing
-- admin profile update policy. Branch admins can read only their own profile as before.

create index if not exists profiles_branch_id_idx on public.profiles(branch_id);

-- Prevent a branch_admin from existing without a branch when the role is assigned.
create or replace function public.validate_profile_branch() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'branch_admin' and new.branch_id is null then
    raise exception 'A branch administrator must be assigned to a branch';
  end if;
  return new;
end $$;

 drop trigger if exists validate_profile_branch on public.profiles;
 create trigger validate_profile_branch before insert or update of role, branch_id on public.profiles
 for each row execute function public.validate_profile_branch();

-- Ministry join tables are scoped through their parent branch.
create policy branch_admin_department_members_select on public.department_members
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_insert on public.department_members
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_update on public.department_members
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_department_members_delete on public.department_members
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.departments d where d.id = department_members.department_id and d.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_group_members_select on public.group_members
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_insert on public.group_members
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_update on public.group_members
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_members_delete on public.group_members
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_members.group_id and g.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_group_attendance_select on public.group_attendance
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_insert on public.group_attendance
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_update on public.group_attendance
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_group_attendance_delete on public.group_attendance
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.groups g where g.id = group_attendance.group_id and g.branch_id = public.app_branch_id()
  )
);

create policy branch_admin_volunteer_schedules_select on public.volunteer_schedules
for select to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_insert on public.volunteer_schedules
for insert to authenticated with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_update on public.volunteer_schedules
for update to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
) with check (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
create policy branch_admin_volunteer_schedules_delete on public.volunteer_schedules
for delete to authenticated using (
  public.app_role() = 'branch_admin' and exists (
    select 1 from public.members m where m.id = volunteer_schedules.person_id and m.branch_id = public.app_branch_id()
  )
);
