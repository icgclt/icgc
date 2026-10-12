# Upgrading Testimony Temple to the latest version

This project is your existing Testimony Temple app (v52) plus every update made in the Dominion Temple app since
it was copied. Your members, finance records and settings stay as they are. **Do not run any of the
`dominion/` or `setup_dominion_temple.sql` files: those create a brand-new church database and are not part of this upgrade.**

Do the steps in this order. The database goes first, then the code.

## 0. Before you start
1. Make a backup: Supabase > Database > Backups (or download one). The migrations cannot be undone automatically.
2. Pick a quiet time (not during a service or while finance is counting).
3. Read "What changes for your people" below so the finance team is not surprised.

## 1. Check the current database (read-only)
Supabase > SQL Editor > New query > paste `supabase/upgrade/00_check_current_state.sql` > Run.
- Rows under **EXPECTED** should all say `true`. If any says `false`, stop and send me that row.
- Rows under **NEW** should say `false` (the upgrade creates them).
- The last table shows the statuses your weekly reports use today.

## 2. Run the upgrade SQL
Run each file as its own new query, in this order, waiting for "Success" each time:
1. `supabase/expenditure_setup.sql`
2. `supabase/migration_52_financial_lock_workflow.sql`
3. `supabase/migration_53_finance_reviewer_role.sql`
4. `supabase/migration_54_finance_review_audit.sql`
5. `supabase/migration_55_finance_status_and_cashbook.sql` (widens the weekly report statuses and creates the Cashbook table only if it is missing)

If one fails, stop and send me the error. Do not skip ahead. Run Step 1 again afterwards: everything should now say `true`.

## 3. Deploy the updated user-management function
```bash
npx supabase link --project-ref avmoellwahpfxtjqkrce
npx supabase functions deploy admin-users --no-verify-jwt
```
Deploy this at the same time as the new code (Step 4): the new Users page and the new function work as a pair.
The other functions did not change.

## 4. Push the code and deploy
Replace the contents of your repo (https://github.com/icgclt/icgc) with this project, commit, and push.
Vercel redeploys automatically. Your environment variables do not change. Never commit a `.env` file.

## 5. Test (use one test member, not real records)
- Sign in as an existing staff user with their email: it still works.
- Users > Create user: choose a member who has a phone number.
- Finance Center: save a draft weekly report, submit it, approve it as a Finance Reviewer.
- Expenditure and Cashbook open and save.
- Audit Log shows readable records.

## What changes for your people
- **Finance approval workflow.** Reports and expenditure go Draft > Submitted > Approved. Once submitted they are
  locked for the finance team. A new **Finance Reviewer** role approves, returns or rejects; the **Pastor** role
  alone can reopen approved records, with a reason. Admin and Super Admin do not approve by default.
  Weekly reports that are already Submitted, Checked or Approved will be locked after the upgrade.
  Create your Finance Reviewer and Pastor users before the next finance day.
- **Creating users.** The Users page now creates a login for an existing member using their phone number
  (the member must have a valid Ghana number). Existing accounts, including email logins, keep working.
- **New pages:** Expenditure, Cashbook, Absentee List. Audit Log has readable records and change details.
- Offline mode, event timing, member portal and several fixes from the Dominion Temple app are included.

## Going back
- Code: in Vercel, open the previous deployment and promote it.
- Database: restore the backup from Step 0. (The new app expects the new tables, so go back to the old code too.)
