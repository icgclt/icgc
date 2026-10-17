-- V60: two members can never share a Member ID again.
-- The Members screen checked this only in the browser, so a bulk import could give many people the same ID.
-- If duplicates still exist this prints a notice and does nothing. Fix them with
-- maintenance_repair_duplicate_member_codes.sql, then run this again.

do $$
begin
  create unique index if not exists members_member_code_unique
    on public.members (lower(trim(member_code)))
    where member_code is not null and trim(member_code) <> '';
exception when unique_violation then
  raise notice 'Duplicate Member IDs still exist, so the rule was not added. Run maintenance_repair_duplicate_member_codes.sql first.';
end $$;
