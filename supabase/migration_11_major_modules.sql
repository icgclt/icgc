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
