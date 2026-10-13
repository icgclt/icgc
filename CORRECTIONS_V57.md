# ICGC Testimony Temple, corrections to v57

Static checks only: syntax, undefined variables, hook order, import/export match, Edge Function syntax, plus
behaviour tests of the receipt printer and CSV export. **Vite could not be run here and the SQL was not run
against a database.** Run `npm install && npm run build` and apply the SQL on a staging project first.

## Build-breaking
- `pages.jsx` imported `escapeHtml` from `utils.js`, which did not export it, so `vite build` would fail. Added.

## Security
- **Role escalation (database):** an Admin could set any profile to `super_admin` by calling the API directly.
  Migration 56 stops anyone but a Super Admin granting or removing Super Admin, Pastor or Finance Reviewer,
  and stops anyone changing their own role (so an Admin cannot make themselves the approver).
- **Pastor / Finance Reviewer could write money tables.** They use the `finance` access template, so they could edit
  giving, pledges, receipts, payment requests, reconciliations and the weekly cash lines, which contradicts the
  release notes. Migration 56 adds restrictive policies that block them on those tables.
- `admin-users`: only a Super Admin can create, reset the password of, or delete Super Admin / Pastor / Finance Reviewer accounts.
- `create-member-portal-user`: no longer resets the password and role of a staff login linked to a member.
- `clear_test_data()`: Super Admin only, and refuses once any finance record is approved (it wipes the audit log).
- Receipt printing (member portal and Finance): every field is HTML-escaped; the pop-up has no link back to the app.
- **Sign-in token left in the address bar** after an email link (seen in your screenshot). Removed once the session is read.
- Paystack webhook: a repeated delivery could record one payment twice. Now claimed atomically, rolled back if the
  receipt or giving write fails, and the signature is compared in constant time.
- `paystack-charge`: a user with no linked member could act on any request with no member.

## Features that could not work
- **Multi-day events** failed on every save (database only allowed none / weekly, and had no `duration_days`). Migration 57.
- **Cashbook** table had no SQL anywhere. Migration 55.
- **Announcements** "Add" button never showed (`allowWrite` is not a Crud prop). Added to the permission map.
- **Pastoral Dashboard** quick-action buttons did nothing (no `onNavigate` was passed). Fixed.
- Pastor could not read pastoral cases (counts always 0). Read-only policy added.
- **Expenditure checkboxes** (your earlier request) were dropped in v57. Restored as View / Manage; approval stays separate. Migration 58 copies current access.

## Role Permissions screen
- The "saved" message was erased by the reload; the group dropdown reset to Admin; saves are now read back and errors shown.
- Permission changes reach signed-in users when the app regains focus. **Correction to my earlier patch:** that version could
  empty the menu on a network error. The new refresh only applies a successful result.

## Data layer
- One failing table no longer stops every table from syncing.
- A queued delete now follows an earlier edit of the same record (it used to report a false conflict).
- Offline queues are read once, not on every render. `remove()` on an unloaded table no longer throws.
- CSV export no longer corrupts negative amounts and `+233` phone numbers.
- Service worker no longer evicts the app shell; manifest icon purpose fixed.

## Messaging
- `send-sms`, `notification-worker`, `paystack-charge` refused the Super Admin role. Fixed.
- Worker: failed messages crowded out new ones; retry-waiting messages did the same; attempts were counted twice. Fixed.
- `send-sms`: maximum 500 recipients per request.

## Audit Log
The Record column showed raw IDs. It now shows readable text (for example `Kwame Mensah · TTA12`, with the changed fields underneath such as `status: Active → Inactive`). Pastoral cases stay generic by design, and private fields (notes, messages, addresses) show only that they were edited. The full ID is still available by hovering the record.

## Housekeeping
Branding fallbacks say ICGC Testimony Temple. Unused imports removed. `.gitignore`, `.env.example` added.
`SETUP.md` lists the migration order. `README_V55` marked superseded (it said the Pastor approves; V57 says the Finance Reviewer).

## Needs your decision (not changed)
1. **Existing expenditure shows as Draft** after migration 52. `supabase/optional/lock_legacy_expenditure.sql` locks older ones once you set a date.
2. **Public sign-up** is open. Turn it off in Supabase Auth.
3. **Offline copies stay on the device after sign-out.** On shared computers this keeps member and finance data.
4. Custom roles get no add/edit buttons on screens that use the generic table screens (the buttons follow the built-in role names).
5. Messages stuck in "Processing" if the worker crashes are not recovered automatically.
6. `finance_workflow_audit` (review and reopening reasons) has no screen; it can be read in Supabase only.
7. Migrations 52-54: `super_admin` and SQL-editor edits to submitted records are blocked by design; use the optional script's trigger pattern.

---
# Round 2 (build of 11 Oct 2026, with your own audit-log, Pastor and ID changes)

Your build was merged with the corrections above; where we both changed the same thing, yours was kept
(your readable Audit Log, your `escapeHtml`, your navigation wiring) and the corrections were added around it.

## Member import (the TTA6 problem)
- The importer in this build still handed every row the same "next ID" even though `MEMBER_ID_IMPORT_FIX.md` said otherwise. Fixed in `pages.jsx`; the note is rewritten to match.
- Safer matching, Excel phone and date repair, and a result summary. See `MEMBER_ID_IMPORT_FIX.md`.
- `maintenance_repair_duplicate_member_codes.sql` always ran `COMMIT` even if duplicates remained; it now aborts instead. Added `migration_60` (unique ID rule) and `maintenance_fix_member_phones.sql`.

## Send SMS for the Pastor
- Now a real permission (`sms.send`) in Role Permissions, checked in the menu, the page and the Edge Function. See `PASTOR_SMS_ACCESS_UPDATE.md`.

## Other corrections
- `PastorDashboard` called hooks after an early return (crash risk when the role changes). Fixed.
- The Pastor could create pastoral cases and follow-ups on screen, but the database refused them. Migration 56 now allows it (no delete).
- Members could no longer change their own password (your build limited them to "My Church"). Added an Account tab.
- Audit Log: free-text fields (notes, addresses, messages) show "changed" instead of copying the old and new text.
