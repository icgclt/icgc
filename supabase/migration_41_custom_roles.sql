-- V41: extensible role groups with a database access template.
-- Super Admin can create additional role groups from Role Permissions.
create table if not exists public.role_catalog (
  role_key text primary key,
  label text not null,
  base_role text not null default 'viewer',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint role_catalog_base_role_check check (base_role in ('admin','finance','secretary','viewer','member'))
);

insert into public.role_catalog(role_key,label,base_role,is_system) values
 ('super_admin','Super Admin','admin',true),
 ('admin','Admin','admin',true),
 ('finance','Finance','finance',true),
 ('secretary','Secretary','secretary',true),
 ('viewer','Viewer','viewer',true),
 ('member','Member','member',true),
 ('sunday_school_teacher','Sunday School Teacher','secretary',true),
 ('pending','Pending','viewer',true)
on conflict (role_key) do update set label=excluded.label, base_role=excluded.base_role, is_system=excluded.is_system;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_role_fkey;
alter table public.profiles add constraint profiles_role_fkey foreign key (role) references public.role_catalog(role_key);

alter table public.role_catalog enable row level security;
drop policy if exists role_catalog_select on public.role_catalog;
drop policy if exists role_catalog_manage on public.role_catalog;
create policy role_catalog_select on public.role_catalog for select to authenticated using (true);
create policy role_catalog_manage on public.role_catalog for all to authenticated
  using (public.app_role() in ('admin'))
  with check (public.app_role() in ('admin'));

-- Resolve custom roles to their selected database access template for existing RLS policies.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as
$$
  select case
    when p.role = 'super_admin' then 'admin'
    else coalesce(rc.base_role, p.role)
  end
  from public.profiles p
  left join public.role_catalog rc on rc.role_key = p.role
  where p.id = auth.uid()
$$;
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;

-- The role-permission screen still controls the application's feature access.
-- The base_role above is only the database/RLS access template.
