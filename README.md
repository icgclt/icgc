# Church Management System - Final Single-Church Edition

This package is the consolidated single-church edition of the Church Management System.

## Main modules

- Dashboard
- Members and bulk CSV import/export
- Families
- Children and child check-in
- Member check-in
- Member ID cards
- Visitors and follow-up
- Groups / House Fellowships
- Prayer requests
- Departments and Department Dashboard
- Service Plans
- Pastoral Care
- Attendance, Quick Attendance and Headcount
- Events, Event Registration and Event Attendance
- Service Countdown Timer
- Finance: Giving, Offerings, First Fruit / Contributions, Digital Receipts, Mobile Money Payments and Reconciliation
- Welfare
- Communication Center
- Notification Center
- Delivery Center
- Engagement and Automation Center
- Reports and Advanced Reports
- Users and Audit Log
- Member self-service portal
- PWA/offline sync foundation

## Intentionally removed from the user interface

This church operates as one church, so branch management, branch assignment, branch intelligence and branch-level access control are not part of this edition.

Volunteer management and the separate Group Dashboard / Volunteer Schedule were also removed from the main application navigation because they are not required for this church's workflow.

The older Supabase migration files are retained for database history and upgrade traceability. They do not create branch navigation in this final application.

## Run locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

## Supabase

Use the migrations that correspond to the modules you have already installed. For a clean installation, apply the base schema and the required numbered migrations in order.

Do not place provider secret keys in the React `.env` file. Payment and messaging provider secrets belong in Supabase Edge Function secrets.

## Single-Church Fine-Tuning
This edition is tailored for a single church with three check-in groups: Adults, Omega (Youth), and Children.
- Upcoming dashboard events show date and time.
- Families and member ID card navigation removed.
- Check-in is one expandable menu with Adults, Omega, and Children.
- Headcount shows Adults, Omega, Children, and detailed gender breakdowns.
- Event registration removed from the main app and member self-service.
- Finance navigation uses Offerings instead of a separate Giving tab.
- First Fruit is separate from Monthly Contributions.
- Monthly Contributions use the main church member database.
- Welfare dues use the main church member database instead of a separate Welfare Members register.
- Service Countdown has separate Timer Setup and Live Countdown screens. Live Countdown is designed as a projection-friendly full-screen view.

## V24: Member records and payment corrections
- First Fruit and Welfare Dues now support direct member/month/amount payment entry.
- First Fruit is recorded against the selected payment month.
- The separate Monthly Contributions menu has been removed.
- Welfare Dues uses the main church Members database.
- Recent headcount history shows each gender/category count.
- Members receive a stable unique Member ID when created or imported.
- Member Record provides a searchable Member ID view of linked attendance, First Fruit, Welfare Dues, receipts, payment requests, prayer requests, follow-ups and children.
- Run `supabase/migration_24_member_records_contributions.sql`.


## V25 updates
- Administrators enter Member IDs manually. Duplicate IDs are blocked in the interface and by a unique database index.
- Children now have a Quick Attendance section directly on the Children page.
- Children Department attendance is stored in `attendance.child_id`, separate from adult/member attendance.
- Run `supabase/migration_25_member_ids_children_attendance.sql`.

## V31 additions
- Member portal accounts use the member's Ghana phone number plus a system-generated temporary password. Deploy `supabase/functions/create-member-portal-user` and enable Supabase Auth > Phone provider (phone/password). Staff can create/reset a member portal password from Members.
- Member IDs are automatically generated: Adult `TTA1...`, Omega `TTO1...`, Child `TTC1...`. When a member changes group, a new group-specific ID is assigned and the old ID is retained in `member_group_history`; IDs are not reused.
- ABC Class is a temporary Sunday Bible Study class under Ministry. It supports a fixed start/end period, selected-member register, weekly attendance, and completion history.
- Pastoral Care categories are a dropdown including Other. Member selectors/searches use member name or ID.
- WhatsApp has been removed from the application UI and notification worker. SMS remains available.
- My Church home shows upcoming event names with their exact date/time instead of only an event count.

Run migrations in order through `migration_31_portal_progression_abc.sql` and `migration_32_clear_new_test_data.sql` after the earlier migrations. Then deploy the portal function:

```text
supabase functions deploy create-member-portal-user
supabase functions deploy notification-worker
```

Phone authentication must be enabled in Supabase Authentication > Providers > Phone before members can sign in with their phone numbers.

## V32 member phone login
- Member portal login uses the member's phone number as the username. Ghana numbers such as `0244457816` are normalized to `+233244457816` for Supabase Auth.
- The portal function generates a temporary password and marks the account `must_change_password=true`. On first login, the member must set a new password before entering the church portal.
- Creating/resetting a portal account again generates a new temporary password and forces another password change.
- No email address is required for a member portal account. Email remains available for staff/admin accounts.
- Phone/password authentication is different from SMS/WhatsApp OTP. To enable member phone login, turn on **Authentication → Providers → Phone** in the Supabase dashboard. Do not enable an SMS provider unless you also want phone confirmation/OTP.
- Deploy the updated Edge Function after copying this version:

```text
supabase functions deploy create-member-portal-user
```
