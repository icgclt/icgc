-- V30: automatic Testimony Temple member IDs.
-- Adults = TTA1, TTA2...
-- Omega = TTO1, TTO2...
-- Children = TTC1, TTC2...
-- The application's permanent member UUID remains unchanged when a person moves groups.

create or replace function public.next_member_code(p_member_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text := case when p_member_type = 'Child' then 'TTC' when p_member_type = 'Omega' then 'TTO' else 'TTA' end;
  n integer := 1;
  candidate text;
begin
  loop
    candidate := prefix || n;
    if not exists (select 1 from public.members where upper(trim(member_code)) = candidate) then
      return candidate;
    end if;
    n := n + 1;
  end loop;
end;
$$;

grant execute on function public.next_member_code(text) to authenticated;
