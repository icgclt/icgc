-- Add Left as a member status. Left members remain in the database/history but are excluded from active operational rosters.

alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('Active','Inactive','Visitor','Left'));

alter table public.member_status_history drop constraint if exists member_status_history_to_status_check;
alter table public.member_status_history add constraint member_status_history_to_status_check
  check (to_status in ('Active','Inactive','Visitor','Left'));
