-- V66: Let the preparer withdraw a submitted weekly cash report before the Finance Reviewer has acted on it.
-- Everything else in the workflow is unchanged: only a Finance Reviewer can approve / return / reject,
-- and only the Pastor can reopen an approved or rejected report. Safe to run more than once. Back up first.

create or replace function public.guard_finance_weekly_report_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_role text;
begin
  select role into actor_role from public.profiles where id = auth.uid();
  if tg_op = 'DELETE' then
    if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot delete/prep financial records.'; end if;
    if old.status in ('Submitted','Checked','Approved','Rejected') then raise exception 'Submitted, rejected, or approved weekly cash reports cannot be deleted.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' and actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot create/prep financial records.'; end if;
  if tg_op = 'INSERT' and new.status = 'Approved' then raise exception 'A weekly cash report must be submitted before approval.'; end if;
  if tg_op = 'UPDATE' then
    if old.status in ('Approved','Rejected') then
      if actor_role is distinct from 'pastor' or new.status <> 'Reopened' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only the Pastor may authorise reopening an approved report, with a reason.'; end if;
      if (to_jsonb(new) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) <> (to_jsonb(old) - array['status','reopen_reason','reopened_by_name','reopened_at','updated_at']) then raise exception 'Reopening cannot change financial figures. Make corrections after reopening.'; end if;
    elsif old.status = 'Submitted' and new.status = 'Draft' and actor_role in ('super_admin','admin','finance') then
      -- V66: the preparer withdraws a submitted report before any review. Figures must not change in the same step.
      if (to_jsonb(new) - array['status','review_reason','updated_at']) is distinct from (to_jsonb(old) - array['status','review_reason','updated_at']) then raise exception 'Withdrawing a submission cannot change its figures. Edit it after it returns to Draft.'; end if;
    elsif old.status in ('Submitted','Checked') then
      if actor_role is distinct from 'finance_reviewer' then
        if new.status <> 'Reopened' or actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null then raise exception 'Only a Finance Reviewer can review submitted reports; only the Pastor can authorise reopening with a reason.'; end if;
      elsif new.status = 'Approved' then
        if (to_jsonb(new) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) <> (to_jsonb(old) - array['status','approved_by_name','approved_at','reviewed_by_name','reviewed_at','review_reason','updated_at']) then raise exception 'Approval cannot alter submitted financial figures.'; end if;
      elsif new.status in ('Returned','Rejected') then
        if nullif(trim(new.review_reason),'') is null then raise exception 'A reason is required to return or reject a report.'; end if;
      elsif new.status <> 'Reopened' then raise exception 'Submitted reports can only be approved, returned, rejected, or reopened by an authorised role.';
      end if;
      if new.status = 'Reopened' and (actor_role is distinct from 'pastor' or nullif(trim(new.reopen_reason),'') is null) then raise exception 'Only the Pastor may authorise reopening, with a reason.'; end if;
    elsif old.status in ('Draft','Reopened','Returned') then
      if actor_role in ('pastor','finance_reviewer') then raise exception 'Pastor and Finance Reviewer roles cannot edit/prep financial records.'; end if;
      if new.status = 'Approved' and actor_role is distinct from 'finance_reviewer' then raise exception 'Only a Finance Reviewer may approve a weekly cash report.'; end if;
      if new.status not in ('Draft','Reopened','Returned','Submitted','Approved') then raise exception 'Invalid weekly cash report workflow status.'; end if;
    end if;
  end if;
  return new;
end $$;
