-- V47: the audit log deletes itself. Every entry is removed once it is older than 30 days.
-- Runs every day at 02:00 GMT (the same as Ghana time), so no entry lives much past a month.
-- To keep entries longer, change both '30 days' below (and run this file again).

create extension if not exists pg_cron;

create or replace function public.auto_purge_audit_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '30 days';
  v_count integer;
begin
  delete from public.audit_log where at < v_cutoff;
  get diagnostics v_count = row_count;

  -- Leave a short note so the cleanup itself is visible in the Audit Log.
  if v_count > 0 then
    insert into public.audit_log (table_name, row_id, action, actor, actor_name, new_row)
    values ('audit_log', null, 'PURGE', null, 'Automatic cleanup',
            jsonb_build_object('deleted', v_count, 'older_than', v_cutoff));
  end if;
  return v_count;
end $$;

-- Only the scheduler (database owner) runs this; the website cannot call it.
revoke all on function public.auto_purge_audit_log() from public, anon, authenticated;

-- (Re)create the schedule without duplicating it if this file is run twice.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'audit-log-auto-purge') then
    perform cron.unschedule('audit-log-auto-purge');
  end if;
  if exists (select 1 from cron.job where jobname = 'cron-history-cleanup') then
    perform cron.unschedule('cron-history-cleanup');
  end if;
  perform cron.schedule('audit-log-auto-purge', '0 2 * * *', 'select public.auto_purge_audit_log()');
  -- The scheduler keeps its own run history; trim it weekly so it never grows.
  perform cron.schedule('cron-history-cleanup', '0 3 * * 0',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$);
end $$;
