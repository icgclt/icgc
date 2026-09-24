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
  select member_id into v_member_id from public.profiles where id = auth.uid();
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
  where id = v_member_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_my_member_profile(text,text,text,text,text,text) from public, anon;
grant execute on function public.update_my_member_profile(text,text,text,text,text,text) to authenticated;

create index if not exists member_notification_preferences_member_idx on public.member_notification_preferences(member_id);

-- Ensure members can see only their own prayer history, attendance and giving.
-- Existing V5 policies remain in place.
