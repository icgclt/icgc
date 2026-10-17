-- OPTIONAL, run once, only if you want existing records locked. Review before running; take a backup first.
--
-- Migration 52 added a 'status' column to expenditures with a default of 'Draft'. Every expenditure you
-- recorded BEFORE the review workflow therefore shows as a Draft, which the Finance team can still edit or delete.
-- This marks those older records as Approved (legacy) so they are locked like everything approved afterwards.
--
-- Choose the cut-off date yourself: only records dated before it are locked.
-- Nothing is changed unless you edit the date below and run the script.

do $$
declare cutoff date := null;   -- <<< set this, for example date '2026-10-01'
begin
  if cutoff is null then
    raise notice 'Cut-off date not set. Nothing was changed.';
    return;
  end if;
  alter table public.expenditures disable trigger guard_expenditure_workflow;
  alter table public.expenditures disable trigger audit_finance_workflow_change;
  update public.expenditures
     set status = 'Approved',
         approved_by_name = 'Legacy record (before review workflow)',
         approved_at = now()
   where status = 'Draft' and coalesce("date", created_at::date) < cutoff;
  alter table public.expenditures enable trigger guard_expenditure_workflow;
  alter table public.expenditures enable trigger audit_finance_workflow_change;
end $$;
