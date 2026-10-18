# Permissions fix (V69) - "I gave them the finance permission but they cannot add expenditure"

## What was wrong
The Role Permissions checkboxes only controlled what the **app shows**. The **database** decided separately, using the
group's "database access template", and for expenditure it only accepted admin / finance / secretary.
So a group created with the default **Viewer** template (or Member) and given "Manage Expenditure" saw the
"Record Expenditure" form, the entry looked saved, then the database refused it when it synced and it quietly
disappeared. The refusal was only listed deep inside Settings.

Three other things can also hide or block the form (these are by design, but nothing explained them):
1. **Expenditure -> Manage is a separate checkbox** from Finance -> Manage (added in V58). Ticking only Finance -> Manage
   is not enough.
2. **A group that has "Review & Approve Financial Records" ticked can never enter expenditure** (separation of duties).
   People who prepare must not also approve.
3. The **Pastor** never enters expenditure.

## What this update changes
* `supabase/migration_69_permission_based_access.sql` - the database now also allows a person whose group has
  Expenditure -> Manage (or Finance -> Manage for Finance Center) ticked. Nothing is narrowed: anyone who could save
  before still can. The finance workflow rules (draft -> submitted -> approved, locked records, reviewer approves,
  Pastor reopens) are untouched.
* Groups with a custom access template now behave like that template on screens that checked fixed role names
  (Finance Center, Cashbook, Deposits, Finance Reconciliation, ...), matching what the database already did.
* Role Permissions: you can now **change a custom group's database access template**, and a red warning appears if
  a group has "add/edit" permissions but a read-only template.
* A red **banner appears on every screen** when the server rejects a change, with the reason and a Dismiss button.
* The Expenditure screen now explains why the form is hidden for approvers.

## What to do
1. Run `migration_69_permission_based_access.sql` once in each church's Supabase SQL Editor (TT and DT).
2. Rebuild and redeploy each app.
3. Ask the affected person to close and reopen the app (or sign out and in) so their device picks up the new rules.
4. Check the group under Role Permissions: **Expenditure -> View and Manage ticked**, and **"Review & Approve
   Financial Records" NOT ticked** for people who should enter expenditure.

## Quick check (optional, read-only)
The bottom of the migration file has a commented query that lists every group with its database template and whether
Expenditure -> Manage, Finance -> Manage and Review & Approve are ticked. Remove the leading `--` and run it to see
which groups were affected.

## Not changed
Other modules (Members, Attendance, Events ...) still use the group's database template for saving, as before; the
new template selector and warning on the Role Permissions screen exist so the two stay consistent.
