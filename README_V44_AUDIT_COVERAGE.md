# V44 - audit coverage

Run `supabase/migration_44_more_audit_coverage.sql` in the Supabase SQL editor. No website redeploy is needed.

It adds change tracking (who, what, when) for the weekly and weekday finance records, reconciliations, pledges, payment receipts and requests, and user accounts (profiles, so role changes are recorded).
Changes made by server functions (for example a role change through the Users page, or a payment callback) have no signed-in person and show as "System".
