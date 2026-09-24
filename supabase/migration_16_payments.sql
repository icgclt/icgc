-- V16: Ghana Mobile Money payment requests and Paystack-ready reconciliation
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  member_name text not null,
  email text,
  phone text not null,
  provider text not null check (provider in ('mtn','vod','atl')),
  amount numeric(14,2) not null check (amount > 0),
  fund text not null default 'Offering',
  reference text unique,
  provider_reference text,
  provider_status text,
  display_message text,
  status text not null default 'Pending' check (status in ('Pending','Processing','Paid','Failed','Expired','Cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  failure_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'Paystack',
  event_type text not null,
  provider_reference text,
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.payment_requests enable row level security;
alter table public.payment_webhook_events enable row level security;

drop policy if exists payment_requests_admin_finance on public.payment_requests;
create policy payment_requests_admin_finance on public.payment_requests for all to authenticated
using (public.app_role() in ('admin','finance'))
with check (public.app_role() in ('admin','finance'));

drop policy if exists payment_requests_member_select on public.payment_requests;
create policy payment_requests_member_select on public.payment_requests for select to authenticated
using (member_id = (select member_id from public.profiles where id=auth.uid()));

drop policy if exists payment_requests_member_insert on public.payment_requests;
create policy payment_requests_member_insert on public.payment_requests for insert to authenticated
with check (member_id = (select member_id from public.profiles where id=auth.uid()));

drop policy if exists payment_webhook_events_admin on public.payment_webhook_events;
create policy payment_webhook_events_admin on public.payment_webhook_events for select to authenticated
using (public.app_role() in ('admin','finance'));

create index if not exists payment_requests_status_idx on public.payment_requests(status, created_at desc);
create index if not exists payment_requests_member_idx on public.payment_requests(member_id, created_at desc);
create index if not exists payment_requests_reference_idx on public.payment_requests(reference);
create index if not exists payment_requests_provider_reference_idx on public.payment_requests(provider_reference);
create index if not exists payment_webhook_provider_ref_idx on public.payment_webhook_events(provider_reference);

-- Allow members to see their own digital receipts as well.
drop policy if exists "payment receipts member read" on public.payment_receipts;
create policy "payment receipts member read" on public.payment_receipts for select to authenticated
using (member_id = (select member_id from public.profiles where id=auth.uid()));
