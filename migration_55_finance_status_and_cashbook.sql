-- V55: two things the newer app needs that earlier migrations do not provide.
-- Safe to run more than once, and safe on a database that already has these. Run AFTER migration_54.
--
-- 1) Weekly reports: allow the workflow statuses used by migrations 52-54 and the app.
--    The original table only allowed Draft / Submitted / Checked / Approved, so Reopen / Return / Reject
--    would fail with a "violates check constraint" error. Existing rows keep their current status.
-- 2) Cashbook: create the cashbook_entries table the Cashbook page saves to (opening balances).
--    No earlier migration creates this table. This definition was written from how the app uses it.
--    If the table already exists in your database it is left completely untouched (columns, policies, triggers).

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.finance_weekly_reports'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.finance_weekly_reports drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.finance_weekly_reports
  add constraint finance_weekly_reports_status_check
  check (status in ('Draft','Submitted','Checked','Approved','Reopened','Returned','Rejected'));

do $mig$
begin
  if to_regclass('public.cashbook_entries') is not null then
    raise notice 'cashbook_entries already exists - left unchanged.';
    return;
  end if;

  execute $sql$create table public.cashbook_entries (
    id uuid primary key,
    entry_date date not null,
    entry_type text not null,
    description text,
    amount numeric(14,2) not null default 0,
    payee text,
    pv_no text,
    receipt_no text,
    cheque_no text,
    source_type text,
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )$sql$;
  execute 'create index cashbook_entries_date_idx on public.cashbook_entries(entry_date)';
  execute 'create index cashbook_entries_updated_at_idx on public.cashbook_entries(updated_at)';
  execute 'alter table public.cashbook_entries enable row level security';
  execute $sql$create policy cashbook_entries_select on public.cashbook_entries for select to authenticated
    using (public.app_role() in ('admin','finance','finance_reviewer','secretary','viewer','pastor','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_insert on public.cashbook_entries for insert to authenticated
    with check (public.app_role() in ('admin','finance','secretary','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_update on public.cashbook_entries for update to authenticated
    using (public.app_role() in ('admin','finance','secretary','super_admin'))
    with check (public.app_role() in ('admin','finance','secretary','super_admin'))$sql$;
  execute $sql$create policy cashbook_entries_delete on public.cashbook_entries for delete to authenticated
    using (public.app_role() in ('admin','super_admin'))$sql$;
  execute 'create trigger cashbook_entries_set_updated_at before update on public.cashbook_entries for each row execute function public.set_updated_at()';
  execute 'create trigger cashbook_entries_audit after insert or update or delete on public.cashbook_entries for each row execute function public.audit_row()';
end
$mig$;
