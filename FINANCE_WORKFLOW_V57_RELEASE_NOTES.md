# ICGC Testimony Temple — Finance Workflow Update (Version 57)

## Included in this source package

- Separate **Finance Reviewer** permission module and dedicated role; approval rights are not part of the general Finance checkbox.
- Finance Reviewer can approve/lock submitted weekly cash reports and expenditure, or return/reject with a required reason.
- Returned records can be edited by the preparer and resubmitted. Rejected records stay locked unless the Pastor documents a reopening.
- Pastor oversight dashboard shows submitted finance items awaiting review, approved income, and approved expenditure; Pastor remains outside routine approval.
- Reopening an approved/rejected record requires Pastor role plus a reason. Reopening does not itself change financial figures.
- Database audit table captures insert/update/delete activity on the finance workflow tables with actor, role, before/after values, and review/reopening reason.
- Finance Reviewer and Pastor are blocked by database triggers from preparing or editing financial figures; Super Admin is not granted routine approval/reopening rights by these workflow triggers.

## Supabase migration order

This application package does **not** apply any database changes automatically. Do not run the migrations on your live database without a current backup and a staging test.

1. Confirm your existing database has the migrations through `migration_52_financial_lock_workflow.sql` applied.
2. In a **staging Supabase project**, review and apply `migration_53_finance_reviewer_role.sql` first.
3. Then review and apply `migration_54_finance_review_audit.sql`.
4. Verify role creation and permissions, row-level security, workflow transitions, and audit rows in staging before scheduling production deployment.

## Suggested staging acceptance checks

1. Finance preparer saves a Draft, submits it, and cannot change figures after submission.
2. Finance Reviewer approves a submitted report/expenditure; the figures remain unchanged and the record becomes locked.
3. Finance Reviewer returns a submission with a reason; preparer can edit and resubmit.
4. Finance Reviewer rejects with a reason; preparer cannot edit it.
5. Pastor can view finance totals but cannot routinely approve or edit records.
6. Pastor can reopen an approved/rejected record only with a reason; reopening is audited and does not change figures.
7. Super Admin cannot approve, return, reject, or reopen through the workflow triggers merely by being Super Admin.
8. Every test change creates rows in `finance_workflow_audit`.

## Verification status and limitations

- Source-level changes and basic delimiter/balance checks were reviewed.
- **Production build could not be completed**: dependency installation timed out, and Vite was unavailable in the local environment. An offline install also failed because required packages were not cached.
- **SQL was not executed or validated against a live/staging PostgreSQL database.** Treat both migrations as unverified until they pass staging tests.
- The package must not be treated as production-certified until the build and staging acceptance checks pass.

## Corrections applied in this package (post-review)

1. **Weekly report navigation**: Report date and week-number selectors are no longer inside the disabled form fieldset. Finance Reviewers and Pastors can switch between weeks without being locked out of navigation.
2. **Review / reopen notes**: The weekly report header shows the reviewer note and, when present, the reopen reason.
3. **RLS for weekday collections**: `migration_54` now grants Finance Reviewer and Pastor read access (and policy alignment for write, still blocked by workflow triggers for prep edits) on `finance_weekday_*` and weekly cash/MoMo line tables. Without this, reviewers could not see weekday offering detail.
4. **Client PERMS**: `finance_reviewer` and `pastor` are included in read access for all finance weekly/weekday tables; Pastor is included on pastoral cases.
5. **Approval label**: When a weekly report is approved, the recorded approver fallback is "Finance Reviewer" (not "Pastor").
