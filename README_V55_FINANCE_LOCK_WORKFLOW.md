# v55 Finance Lock and Pastor Reopening Workflow

## Workflow
- Finance team members prepare weekly cash reports and expenditure records as drafts.
- Finance team members submit them for review.
- Only a profile whose role is exactly `pastor` can approve and lock submitted records.
- Only the Pastor can authorise reopening an approved/locked record, and a reason is required.
- Super Admin is not granted Pastor approval/reopening authority by this workflow.
- Database triggers protect weekly cash report totals and detail lines, weekday collection lines, and expenditure records. Audit logging already configured on the finance tables remains in place.

## Required deployment step
Before using this version against Supabase, apply `supabase/migration_52_financial_lock_workflow.sql` in the Supabase SQL Editor. The UI alone is not a security boundary; this migration is required to enforce locking on the server.

## Role setup
Set the intended Pastor account's `profiles.role` to `pastor` using the existing role-management process. Ensure the Pastor has access to the Finance Center and Expenditure modules so they can review and approve. Finance team accounts should have the finance/expenditure management permissions needed for daily entry, but should not be assigned the `pastor` role.

## Important
The workflow is designed to preserve original records and audit history. A correction after approval must have a reason; where possible, prefer a documented adjustment/reversal rather than changing the original entry. Test first with a draft report and a test expenditure before relying on this in live finance operations.
