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
