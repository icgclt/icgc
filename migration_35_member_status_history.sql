-- Member status history and safe reactivation workflow.
-- Stores only lightweight audit metadata; member records themselves are retained.

alter table public.members add column if not exists status_reason text;
alter table public.members add column if not exists status_notes text;
alter table public.members add column if not exists status_changed_at timestamptz default now();

create table if not exists public.member_status_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('Active','Inactive','Visitor','Left')),
  reason text,
  notes text,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index if not exists member_status_history_member_idx
  on public.member_status_history(member_id, changed_at desc);

alter table public.member_status_history enable row level security;

drop policy if exists member_status_history_select on public.member_status_history;
create policy member_status_history_select on public.member_status_history
  for select to authenticated
  using (public.app_role() in ('admin','finance','secretary','viewer'));

drop policy if exists member_status_history_insert on public.member_status_history;
create policy member_status_history_insert on public.member_status_history
  for insert to authenticated
  with check (public.app_role() in ('admin','secretary'));

drop policy if exists member_status_history_update on public.member_status_history;
create policy member_status_history_update on public.member_status_history
  for update to authenticated
  using (public.app_role() in ('admin'))
  with check (public.app_role() in ('admin'));

drop policy if exists member_status_history_delete on public.member_status_history;
create policy member_status_history_delete on public.member_status_history
  for delete to authenticated
  using (public.app_role() in ('admin'));

create or replace function public.set_member_status_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_status_timestamp on public.members;
create trigger trg_member_status_timestamp
before update of status on public.members
for each row execute function public.set_member_status_changed_at();

create or replace function public.record_member_status_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.member_status_history(member_id, from_status, to_status, reason, notes, changed_at, changed_by)
    values (new.id, null, new.status, coalesce(nullif(trim(new.status_reason), ''), 'Member created'), new.status_notes, coalesce(new.status_changed_at, now()), coalesce(auth.uid(), new.created_by));
  elsif new.status is distinct from old.status then
    insert into public.member_status_history(member_id, from_status, to_status, reason, notes, changed_at, changed_by)
    values (new.id, old.status, new.status,
      nullif(trim(coalesce(new.status_reason, '')), ''),
      nullif(trim(coalesce(new.status_notes, '')), ''),
      coalesce(new.status_changed_at, now()), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_member_status_history on public.members;
create trigger trg_member_status_history
after insert or update of status on public.members
for each row execute function public.record_member_status_history();

-- Backfill a lightweight initial status event for existing members only when no history exists.
insert into public.member_status_history(member_id, from_status, to_status, reason, changed_at, changed_by)
select m.id, null, m.status, 'History started', coalesce(m.status_changed_at, m.created_at, now()), m.created_by
from public.members m
where not exists (select 1 from public.member_status_history h where h.member_id = m.id);
