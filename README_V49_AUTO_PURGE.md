# V49 - automatic audit log cleanup

Run `supabase/migration_47_auto_purge_audit_log.sql` in the Supabase SQL editor. No website redeploy is needed.

- Every day at 02:00 GMT, audit entries older than 30 days are deleted. A short "Automatic cleanup" note records how many.
- A weekly job also trims the scheduler's own run history.
- To change the 30 days, edit both occurrences in the file and run it again.
- Check it: Supabase > Integrations > Cron (or run `select jobname, schedule, active from cron.job;`).
- The manual "Delete old entries" buttons on the Audit Log page still work but are no longer needed.
