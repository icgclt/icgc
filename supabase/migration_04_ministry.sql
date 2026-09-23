-- Migration 04: ministry operations, follow-up, groups, prayer, volunteers and service planning.
-- Run after schema.sql and earlier migrations.

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  visit_date date not null default current_date,
  name text not null,
  phone text,
  gender text check (gender in ('Male','Female')),
  invited_by text,
  address text,
  prayer_request text,
  notes text,
  follow_up_status text not null default 'New' check (follow_up_status in ('New','Contacted','Visited','Connected','Closed')),
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_type text not null default 'House Fellowship',
  leader text,
  assistant_leader text,
  meeting_day text,
  meeting_time text,
  location text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  person_name text not null,
  phone text,
  category text not null default 'Member',
  reason text not null,
  assigned_to text,
  method text default 'Phone',
  outcome text,
  next_action text,
  next_date date,
  status text not null default 'Open' check (status in ('Open','In Progress','Completed','Closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  requester text not null,
  phone text,
  request text not null,
  category text default 'General',
  confidential boolean not null default false,
  assigned_to text,
  status text not null default 'New' check (status in ('New','Assigned','Praying','Answered','Closed')),
  answered_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  ministry text not null,
  role_name text,
  phone text,
  availability text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.service_plans (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_name text not null default 'Sunday Service',
  item_order int not null default 1,
  service_item text not null,
  assigned_to text,
  duration text,
  status text not null default 'Planned' check (status in ('Planned','Confirmed','Completed','Cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.pastoral_cases (
  id uuid primary key default gen_random_uuid(),
  opened_date date not null default current_date,
  person_name text not null,
  category text not null default 'Pastoral Care',
  assigned_to text,
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  status text not null default 'Open' check (status in ('Open','In Progress','Resolved','Closed')),
  private_notes text,
  next_follow_up date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

do $$ declare t text; begin
  foreach t in array array['visitors','groups','follow_ups','prayer_requests','volunteers','service_plans','pastoral_cases'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert to authenticated with check (public.app_role() in ('admin','secretary'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated using (public.app_role() = 'admin')$p$, t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create index if not exists visitors_visit_date_idx on public.visitors (visit_date desc);
create index if not exists visitors_status_idx on public.visitors (follow_up_status);
create index if not exists follow_ups_next_date_idx on public.follow_ups (next_date);
create index if not exists prayer_requests_status_idx on public.prayer_requests (status);
create index if not exists service_plans_date_idx on public.service_plans (service_date, item_order);
create index if not exists pastoral_cases_status_idx on public.pastoral_cases (status);

-- Pastoral cases are confidential. Replace the generic policies created above with restricted policies.
alter table public.pastoral_cases enable row level security;
drop policy if exists pastoral_cases_select on public.pastoral_cases;
drop policy if exists pastoral_cases_insert on public.pastoral_cases;
drop policy if exists pastoral_cases_update on public.pastoral_cases;
drop policy if exists pastoral_cases_delete on public.pastoral_cases;
create policy pastoral_cases_select on public.pastoral_cases for select to authenticated using (public.app_role() in ('admin','secretary'));
create policy pastoral_cases_insert on public.pastoral_cases for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy pastoral_cases_update on public.pastoral_cases for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy pastoral_cases_delete on public.pastoral_cases for delete to authenticated using (public.app_role() = 'admin');
