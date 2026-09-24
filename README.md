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
