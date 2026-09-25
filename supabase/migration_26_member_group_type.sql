-- V26: distinguish the three church groups in the unified member database.
alter table public.members
  add column if not exists member_type text not null default 'Adult';

update public.members
set member_type = case
  when lower(coalesce(member_type,'')) in ('adult','omega','child') then member_type
  else 'Adult'
end;

alter table public.members
  drop constraint if exists members_member_type_check;

alter table public.members
  add constraint members_member_type_check
  check (member_type in ('Adult','Omega','Child'));

create index if not exists members_member_type_idx on public.members(member_type);
