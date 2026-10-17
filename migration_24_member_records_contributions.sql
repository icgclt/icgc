-- V24: member-linked First Fruit / Welfare Dues and Member Record support
-- Run after the existing migrations.

alter table public.member_contributions
  add column if not exists member_id uuid references public.members(id) on delete set null;

create index if not exists member_contributions_member_id_idx
  on public.member_contributions(member_id);

-- Backfill existing records where the member can be matched by name.
update public.member_contributions mc
set member_id = m.id
from public.members m
where mc.member_id is null
  and lower(trim(mc.person_name)) = lower(trim(m.name));

-- Keep the existing fund/person/month uniqueness so old data remains compatible.
-- New records use member_id as well, while person_name remains as a readable snapshot.
