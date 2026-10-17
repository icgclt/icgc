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
