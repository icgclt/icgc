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
