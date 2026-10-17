-- V68: members can see their OWN First Fruit payments (read-only) in the member portal.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- member_contributions was readable only by admin/finance (and branch admins). This adds one extra
-- SELECT policy so a signed-in member can read rows that are
--   * in the 'First Fruit' fund (Welfare Dues stay private), and
--   * linked to their own member record (the same rule already used for giving_member_select).
-- No insert/update/delete access is granted.

drop policy if exists member_contributions_member_select on public.member_contributions;

create policy member_contributions_member_select on public.member_contributions
  for select to authenticated
  using (
    fund = 'First Fruit'
    and member_id is not null
    and member_id = (select member_id from public.profiles where id = auth.uid())
  );
