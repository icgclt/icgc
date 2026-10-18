# Corrections after reviewing both apps (Testimony Temple and Dominion Temple)

Static review only: every source file parses, no undefined names, every import matches an export, and every table,
RPC, permission key and Edge Function the app uses exists in the SQL. Vite could not be run here (the bundled
native modules do not match this machine) and no SQL was run against a database. Run `npm install && npm run build`
and test on a staging project first.

## Gaps found and fixed
1. **Dominion Temple database setup stopped at migration 47.** The app needs migrations 52-63, so a new Dominion
   database would have had no Expenditure, no finance approval workflow, no Cashbook, no role-escalation protection,
   no multi-day events, no Expenditure / Send SMS permissions, no unique Member ID rule, no Backup & Restore, broken
   Visitors saves, and Prayer/Pastoral records open to every staff role.
   - Added `supabase/dominion/dominion_setup_part_8_of_10.sql` (expenditure, 52-54), `part_9` (55-60) and `part_10` (61-63).
   - The old parts are renamed `..._of_10`. `setup_dominion_temple.sql` (single file) now ends with the same content.
   - Existing Dominion databases built from the old 7 parts: run only parts 8, 9 and 10.
2. **Testimony Temple upgrade guide stopped at migration 60.** Migrations 61 (Backup & Restore), 62 (Visitors columns)
   and 63 (Pastor-only care and prayer) are now steps 12-14 in `UPGRADE_TT_TO_LATEST.md`, with warnings (create a
   Pastor user first; pg_cron needed).
3. **`maintenance_repair_duplicate_member_codes.sql` hard-coded `TT` IDs.** Run in Dominion it would have issued
   TTA/TTO/TTC numbers. It now takes the church letters from the duplicated ID itself.
4. **`member-code-login` Edge Function** is unused by the app but the guide told you to deploy it with `--no-verify-jwt`.
   That is a public sign-in endpoint with no attempt limiting. Removed from the deploy lists and marked "do not deploy".
5. **Setup guide** for new churches now covers 10 parts, `send-sms`, the Pastor and Finance Reviewer users, and checking
   the first Backup snapshot.
6. **Pre-upgrade check script** also reports the Backup table and the Visitors `email` column.

## Needs your decision (not changed)
- Public sign-up is still open in both Supabase projects; turn it off in Authentication.
- Migration 63 makes Prayer/Pastoral records Pastor-only, including from Super Admin. If the Pastor account is ever
  lost, those records can only be read from Supabase directly.
- `dist/` in the zip is an old build; it is git-ignored. Rebuild before deploying.
- Several earlier "needs your decision" items in `CORRECTIONS_V57.md` (custom role buttons, stuck "Processing"
  messages, no screen for `finance_workflow_audit`) are still open.
