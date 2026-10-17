-- V27: keep children in the main Members module and capture parent/guardian particulars.
alter table public.members add column if not exists parent1_name text;
alter table public.members add column if not exists parent1_phone text;
alter table public.members add column if not exists parent1_relationship text;
alter table public.members add column if not exists parent2_name text;
alter table public.members add column if not exists parent2_phone text;
alter table public.members add column if not exists parent2_relationship text;

create index if not exists members_parent1_phone_idx on public.members(parent1_phone);
create index if not exists members_parent2_phone_idx on public.members(parent2_phone);
