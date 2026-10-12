# Lighter sync and audit log cleanup

## Lighter sync (website change)
`src/data.jsx`: after its first full download, each device now asks only for rows changed since its last sync, for the big tables (members, attendance, headcount, giving, offerings, contributions, welfare, visitors, groups, follow-ups, prayer requests, service plans, pastoral cases, notification preferences).
- Rows deleted by someone else are removed from a device by a small ids-only check, at most once an hour and whenever "Sync now" is pressed.
- Tables not in that list are still downloaded in full each time, as before.
- Daily egress no longer grows with the size of the attendance table. The first load on a new device or after clearing the browser is still a full download.

## Audit log cleanup
1. Run `supabase/migration_46_purge_audit_log.sql` in the Supabase SQL editor.
2. Push the website to GitHub so Vercel redeploys.
The Super Admin then sees "Delete entries older than ... [Delete old entries]" at the top of the Audit Log page.
Entries from the last 30 days can never be deleted, and a PURGE row records who cleaned up and how many entries went.

## Known limit
Fixed in V48 (offline copy moved to IndexedDB). See README_V48_OFFLINE_STORAGE.md.
