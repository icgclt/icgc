# Prayer Requests and Pastoral Care are Pastor-only

**What changed**
- The menu items **Prayer Requests**, **Pastoral Care** and **Pastoral Dashboard** are shown only to users whose role is exactly `Pastor`.
  Super Admin, Admin, Secretary, Finance, Finance Reviewer, Viewer and custom roles no longer see them, whatever is ticked in Role Permissions.
- The pages refuse to open for anyone else, even through a saved link.
- **Member Record** no longer shows the member's prayer requests to other roles, and **Advanced Reports** no longer shows the
  "Open prayer requests" card to other roles.
- The **Audit Log** hides entries about these two tables from everyone except the Pastor.
- **Downloaded backup files** no longer contain these two tables (an administrator cannot read them). They are still included in the
  automatic nightly server snapshots and in "Save snapshot on server".
- Members still send and read their own prayer requests in the member portal. Those requests now reach the Pastor only.
- The Pastor can now add, edit and delete prayer requests and pastoral cases (previously the database blocked the Pastor from adding).

**Required database step (once per church, in the Supabase SQL Editor)**
Run `supabase/migration_63_pastor_only_care_prayer.sql`. The screens alone are not a security boundary; this migration makes the database
enforce the rule. Take a backup first.

**Before you run it**
- Make sure at least one user has the **Pastor** role (Users > Create user, role Pastor). Nobody else can open these records afterwards.
- If you also have not run it yet, run `migration_62_visitors_form_columns.sql` (fixes visitors disappearing after a refresh).

**After you deploy**
- Rebuild and redeploy the app. Devices that cached these records for other roles clear them on their next sync.
