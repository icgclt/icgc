-- MANUAL MAINTENANCE SCRIPT: repair duplicate member IDs created by a bulk CSV import.
-- Do NOT run on production until you have backed up the database and reviewed the preview query.
-- This preserves one existing ID per duplicate group (oldest created_at, then id),
-- and assigns fresh sequential IDs to the other rows using their member_type prefix.
-- Related attendance/finance/etc. rows remain linked because their foreign keys use members.id,
-- not member_code. This script only changes member_code values.

-- 1) Preview duplicates first. Run this SELECT separately before running the DO block.
-- select member_code, count(*) as records,
--        array_agg(name order by created_at nulls first, id) as member_names
-- from public.members
-- where member_code is not null and trim(member_code) <> ''
-- group by lower(trim(member_code)), member_code
-- having count(*) > 1
-- order by member_code;

begin;

do $$
declare
  rec record;
  prefix text;
  next_num integer;
  new_code text;
begin
  for rec in
    with ranked as (
      select id, member_code, member_type, name, created_at,
             row_number() over (
               partition by lower(trim(member_code))
               order by created_at nulls first, name, id
             ) as duplicate_rank
      from public.members
      where member_code is not null and trim(member_code) <> ''
    )
    select id, member_code, member_type, name, created_at
    from ranked
    where duplicate_rank > 1
    order by lower(trim(member_code)), created_at nulls first, name, id
  loop
    prefix := case
      when rec.member_type = 'Child' then 'TTC'
      when rec.member_type = 'Omega' then 'TTO'
      else 'TTA'
    end;

    loop
      select coalesce(max((substring(upper(trim(member_code)) from length(prefix) + 1))::integer), 0) + 1
        into next_num
      from public.members
      where upper(trim(member_code)) ~ ('^' || prefix || '[0-9]+$');

      new_code := prefix || next_num::text;
      exit when not exists (
        select 1 from public.members
        where lower(trim(member_code)) = lower(new_code)
          and id <> rec.id
      );
    end loop;

    raise notice 'Reassigning member ID for % (member row %): % -> %', rec.name, rec.id, rec.member_code, new_code;

    update public.members
       set member_code = new_code
     where id = rec.id;
  end loop;
end $$;

-- Safety check. If any duplicate Member ID is left, this stops with an error and the whole script is rolled back,
-- so nothing is changed. It only reaches COMMIT when every nonblank Member ID is unique.
do $$
begin
  if exists (
    select 1 from public.members
    where member_code is not null and trim(member_code) <> ''
    group by lower(trim(member_code))
    having count(*) > 1
  ) then
    raise exception 'Duplicate Member IDs still exist after the repair. Nothing was changed.';
  end if;
end $$;

commit;

-- After a successful repair, run migration_60_unique_member_code.sql so this cannot happen again.
