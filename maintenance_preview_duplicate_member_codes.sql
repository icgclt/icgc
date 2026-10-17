-- READ-ONLY PREVIEW: this query does not change any records.
-- Run it first in Supabase SQL Editor and inspect every listed name.
select
  lower(trim(member_code)) as normalized_member_code,
  count(*) as record_count,
  array_agg(name order by created_at nulls first, id) as member_names,
  array_agg(id::text order by created_at nulls first, id) as member_row_ids
from public.members
where member_code is not null and trim(member_code) <> ''
group by lower(trim(member_code))
having count(*) > 1
order by normalized_member_code;
