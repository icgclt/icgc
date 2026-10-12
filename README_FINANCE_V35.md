# Church Finance v35 upgrade

This patch models the church's Excel finance workflow while leaving attendance in the existing Attendance module.

## Included
- `pages.jsx`: replaces the old Finance Center with a weekly cash-counting workflow plus monthly, quarterly and yearly summaries and First Fruit register access.
- `data.jsx`: loads the three new finance tables.
- `auth.jsx`: adds finance permissions for the new tables.
- `App.jsx`: exposes Finance Center in the Finance navigation.
- `finance_workbook_model_v35.sql`: creates the required Supabase tables, indexes and RLS policies.

## Finance workflow
Weekly report -> denomination cash count per income category -> MoMo per category -> weekly total -> automatic monthly -> quarterly -> yearly summaries.

Income categories:
Main Offering, Project Offering, Children's Offering, First Fruit, Weekday Offering, Donation, Thanksgiving, Pledges.

Cash denominations:
GH₵200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10.

The First Fruit Register continues to use the existing member contribution grid, so existing First Fruit data is not duplicated.

## Deployment order
1. Back up the current project.
2. Apply `finance_workbook_model_v35.sql` in Supabase SQL Editor.
3. Replace the four source files with the patched versions.
4. Run `npm install`.
5. Run `npm run build`.
6. Deploy to Vercel.

No attendance table or attendance workflow is changed by this finance patch.
