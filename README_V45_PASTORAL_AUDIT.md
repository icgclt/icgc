# V45 - pastoral care audit without contents

Run `supabase/migration_45_pastoral_audit_no_content.sql` in the Supabase SQL editor. No website redeploy is needed.

Pastoral case changes still appear in the Audit Log (who, what kind of change, when), but the case contents are no longer copied into the log.
The migration also clears the contents already copied into earlier log rows. The last statement in the file does this; delete it first if you would rather keep them.
