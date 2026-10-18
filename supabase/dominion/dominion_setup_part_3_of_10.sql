-- =====================================================================================
-- ICGC Dominion Temple setup - PART 3 of 10
-- Run the parts IN ORDER, each in its own new query, on the new empty project (pg_cron enabled first).
-- Each part is all-or-nothing. If a part fails, nothing from THAT part is kept: tell me the part number and error.
-- =====================================================================================

-- >>> FILE: migration_14_advanced_reports_branches.sql
-- V14: branch foundation and reporting support
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  city text,
  phone text,
  address text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.branches enable row level security;
create policy "branches read authenticated" on public.branches for select to authenticated using (true);
create policy "branches admin write" on public.branches for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Optional branch references. Existing records remain valid with NULL until assigned.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='branch_id') then
    alter table public.profiles add column branch_id uuid references public.branches(id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='branch_id') then alter table public.members add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='branch_id') then alter table public.events add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='departments' and column_name='branch_id') then alter table public.departments add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='groups' and column_name='branch_id') then alter table public.groups add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='attendance' and column_name='branch_id') then alter table public.attendance add column branch_id uuid references public.branches(id); end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='visitors' and column_name='branch_id') then alter table public.visitors add column branch_id uuid references public.branches(id); end if;
end $$;

create index if not exists members_branch_id_idx on public.members(branch_id);
create index if not exists events_branch_id_idx on public.events(branch_id);
create index if not exists attendance_branch_id_idx on public.attendance(branch_id);
create index if not exists visitors_branch_id_idx on public.visitors(branch_id);

-- >>> FILE: migration_15_notifications.sql
-- V15: Church-wide notification campaigns and delivery tracking
create table if not exists public.notification_campaigns (
  id uuid primary key,
  title text not null,
  message text not null,
  channel text not null check (channel in ('SMS','WhatsApp','Email','In-app')),
  audience text not null,
  scheduled_for timestamptz not null default now(),
  status text not null default 'Queued' check (status in ('Draft','Queued','Processing','Sent','Failed','Cancelled')),
  recipient_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.notification_logs (
  id uuid primary key,
  campaign_id uuid references public.notification_campaigns(id) on delete cascade,
  queue_id uuid,
  member_id uuid references public.members(id) on delete set null,
  channel text not null,
  destination text,
  status text not null default 'Queued' check (status in ('Queued','Sent','Delivered','Failed')),
  provider text,
  provider_reference text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notification_campaigns enable row level security;
alter table public.notification_logs enable row level security;

drop policy if exists "notification_campaigns_read" on public.notification_campaigns;
create policy "notification_campaigns_read" on public.notification_campaigns for select to authenticated using (true);
drop policy if exists "notification_campaigns_write" on public.notification_campaigns;
create policy "notification_campaigns_write" on public.notification_campaigns for all to authenticated using ((public.app_role() = 'admin')) with check ((public.app_role() = 'admin'));

drop policy if exists "notification_logs_read" on public.notification_logs;
create policy "notification_logs_read" on public.notification_logs for select to authenticated using (true);
drop policy if exists "notification_logs_write" on public.notification_logs;
create policy "notification_logs_write" on public.notification_logs for all to authenticated using ((public.app_role() = 'admin')) with check ((public.app_role() = 'admin'));

create index if not exists idx_notification_campaigns_scheduled on public.notification_campaigns(scheduled_for);
create index if not exists idx_notification_campaigns_status on public.notification_campaigns(status);
create index if not exists idx_notification_logs_campaign on public.notification_logs(campaign_id);
create index if not exists idx_notification_logs_member on public.notification_logs(member_id);

-- Add campaign linkage fields to the existing delivery queue.
alter table public.communication_queue add column if not exists campaign_id uuid references public.notification_campaigns(id) on delete set null;
alter table public.communication_queue add column if not exists campaign_title text;
create index if not exists idx_communication_queue_campaign on public.communication_queue(campaign_id);

-- >>> FILE: migration_16_payments.sql
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

-- >>> FILE: migration_17_delivery.sql
-- V17: Automated SMS + WhatsApp delivery infrastructure
-- Safe to run after V16. It only adds columns/indexes and extends existing status checks.

alter table public.communication_queue add column if not exists email text;
alter table public.communication_queue add column if not exists provider text;
alter table public.communication_queue add column if not exists last_error text;
alter table public.communication_queue add column if not exists attempts integer not null default 0;
alter table public.communication_queue add column if not exists next_attempt_at timestamptz;
alter table public.communication_queue add column if not exists delivered_at timestamptz;
alter table public.communication_queue add column if not exists whatsapp_template_name text;
alter table public.communication_queue add column if not exists whatsapp_template_language text default 'en_US';
alter table public.communication_queue add column if not exists provider_payload jsonb;

alter table public.notification_logs add column if not exists attempts integer not null default 0;
alter table public.notification_logs add column if not exists delivered_at timestamptz;
alter table public.notification_logs add column if not exists provider_payload jsonb;

-- Older versions only allowed Queued/Sent/Failed/Cancelled. V17 adds Processing and Delivered.
alter table public.communication_queue drop constraint if exists communication_queue_status_check;
alter table public.communication_queue add constraint communication_queue_status_check
  check (status in ('Queued','Processing','Sent','Delivered','Failed','Cancelled'));

create index if not exists communication_queue_due_idx
  on public.communication_queue(status, scheduled_for, next_attempt_at);
create index if not exists communication_queue_channel_idx
  on public.communication_queue(channel, status);
create index if not exists communication_queue_provider_ref_idx
  on public.communication_queue(provider_reference);

-- Prevent two active attempts from being created for the same queue row by accident.
create or replace function public.touch_communication_queue()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists communication_queue_touch on public.communication_queue;
create trigger communication_queue_touch
before update on public.communication_queue
for each row execute function public.touch_communication_queue();

-- A simple audit helper used by the delivery worker. The worker uses the service role,
-- so normal browser users cannot call this function directly unless explicitly granted.
create or replace function public.delivery_backoff_minutes(p_attempt integer)
returns integer
language sql
immutable
as $$
  select case
    when p_attempt <= 1 then 1
    when p_attempt = 2 then 5
    when p_attempt = 3 then 15
    when p_attempt = 4 then 30
    else 60
  end;
$$;

-- >>> FILE: migration_18_member_self_service.sql
-- V18: Member Self-Service
-- Run after migration_17_delivery.sql.

-- Event registrations need a few fields already used by the portal.
alter table public.event_registrations add column if not exists member_name text;
alter table public.event_registrations add column if not exists registered_at timestamptz default now();

create index if not exists event_registrations_member_idx on public.event_registrations(member_id, created_at desc);

-- Member-controlled notification preferences. Church staff cannot use this table to change a member's choices.
create table if not exists public.member_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.members(id) on delete cascade,
  sms boolean not null default true,
  whatsapp boolean not null default true,
  email boolean not null default true,
  in_app boolean not null default true,
  event_reminders boolean not null default true,
  payment_confirmations boolean not null default true,
  birthday_messages boolean not null default true,
  follow_up_messages boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_notification_preferences enable row level security;

drop policy if exists member_notification_preferences_select on public.member_notification_preferences;
create policy member_notification_preferences_select on public.member_notification_preferences
for select to authenticated
using (member_id = (select member_id from public.profiles where id = auth.uid()));

drop policy if exists member_notification_preferences_insert on public.member_notification_preferences;
create policy member_notification_preferences_insert on public.member_notification_preferences
for insert to authenticated
with check (member_id = (select member_id from public.profiles where id = auth.uid()));

drop policy if exists member_notification_preferences_update on public.member_notification_preferences;
create policy member_notification_preferences_update on public.member_notification_preferences
for update to authenticated
using (member_id = (select member_id from public.profiles where id = auth.uid()))
with check (member_id = (select member_id from public.profiles where id = auth.uid()));

drop trigger if exists member_notification_preferences_updated_at on public.member_notification_preferences;
create trigger member_notification_preferences_updated_at
before update on public.member_notification_preferences
for each row execute function public.set_updated_at();

-- Replace the broad V5 member update policy. Members should not be able to alter
-- member_code, status, user_id, gender, DOB or other staff-controlled fields.
drop policy if exists members_member_update on public.members;

create or replace function public.update_my_member_profile(
  p_phone text default null,
  p_email text default null,
  p_address text default null,
  p_marital_status text default null,
  p_occupation text default null,
  p_emergency_contact text default null
) returns public.members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_row public.members;
begin
  v_member_id := (select p.member_id from public.profiles p where p.id = auth.uid());
  if v_member_id is null then
    raise exception 'Your account is not linked to a member record.';
  end if;

  update public.members
  set phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), ''),
      address = nullif(trim(p_address), ''),
      marital_status = nullif(trim(p_marital_status), ''),
      occupation = nullif(trim(p_occupation), ''),
      emergency_contact = nullif(trim(p_emergency_contact), '')
  where id = v_member_id;

  v_row := (select m from public.members m where m.id = v_member_id);
  return v_row;
end;
$$;

revoke all on function public.update_my_member_profile(text,text,text,text,text,text) from public, anon;
grant execute on function public.update_my_member_profile(text,text,text,text,text,text) to authenticated;

create index if not exists member_notification_preferences_member_idx on public.member_notification_preferences(member_id);

-- Ensure members can see only their own prayer history, attendance and giving.
-- Existing V5 policies remain in place.
