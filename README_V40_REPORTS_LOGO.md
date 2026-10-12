# Church Management v40 – Logo + Reports Consolidation

Built from the v39.3 working baseline.

## Changes
- Added the I.C.G.C logo to the application sidebar and sign-in screen.
- Added the logo as the browser favicon.
- Removed the standalone Reports navigation item.
- Consolidated Reports into Advanced Reports with Overview and Reports tabs.
- Removed the old Event Activity, Attendance Trend and Finance Trend panels.
- Added date-range exports for:
  - Monthly Member Attendance (all members or one selected member)
  - Headcount
  - Welfare Dues
  - Finance Center (all eight Finance Center categories)
- Finance export uses the current Finance Center weekly reports and Weekday Offering collections.
- Added migration_41_reports_consolidation.sql.
- Preserved Audit Log access with a dedicated audit.view permission after removing the obsolete reports.view permission.
- Finance role receives Advanced Reports access so Finance users can export Finance Center reports; report sections are still permission-gated.

## Supabase migration
Run `supabase/migration_41_reports_consolidation.sql` after the existing migrations.

## Build
On Windows:

```cmd
npm install
npm run build
```

Then test the Reports tab and exports before deploying.
