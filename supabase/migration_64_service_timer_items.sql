-- V64: Service timer list is now shared by every device (it used to live only on one device).
-- Safe to run more than once.
create table if not exists public.service_timer_items (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0,
  person text not null,
  role text,
  minutes integer not null default 5 check (minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists service_timer_items_position_idx on public.service_timer_items(position);

alter table public.service_timer_items enable row level security;
drop policy if exists service_timer_items_select on public.service_timer_items;
drop policy if exists service_timer_items_insert on public.service_timer_items;
drop policy if exists service_timer_items_update on public.service_timer_items;
drop policy if exists service_timer_items_delete on public.service_timer_items;
create policy service_timer_items_select on public.service_timer_items
  for select to authenticated using (public.app_role() in ('admin','finance','secretary','viewer'));
create policy service_timer_items_insert on public.service_timer_items
  for insert to authenticated with check (public.app_role() in ('admin','secretary'));
create policy service_timer_items_update on public.service_timer_items
  for update to authenticated using (public.app_role() in ('admin','secretary')) with check (public.app_role() in ('admin','secretary'));
create policy service_timer_items_delete on public.service_timer_items
  for delete to authenticated using (public.app_role() in ('admin','secretary'));

drop trigger if exists service_timer_items_set_updated_at on public.service_timer_items;
create trigger service_timer_items_set_updated_at
  before update on public.service_timer_items
  for each row execute function public.set_updated_at();
