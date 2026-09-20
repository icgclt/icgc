# Church Management System — React + Supabase

A mobile-friendly web app (installable as a PWA) for member records, attendance, giving, departments and events,
with real logins, role-based access and an offline queue.

## What you get
- **Login + roles** — `admin`, `finance`, `secretary`, `viewer` (new sign-ups start as `pending` and see nothing until approved)
- **Modules** — Members, Attendance, Giving (tithes/offerings, cash / mobile money / bank / card), Departments, Events, Reports, CSV export
- **Security in the database** — Postgres row-level security enforces the roles, so they hold even if someone bypasses the UI
- **Audit log** — every insert/update/delete is recorded with who did it (`audit_log` table, admin-readable)
- **Works with poor internet** — the app shell is cached; new/edited/deleted records are saved on the device instantly and
  synced to Supabase in the background when a connection is available. A badge shows Online/Offline and how many changes are waiting.

## Setup (about 10 minutes)

### 1. Create the Supabase project
1. https://supabase.com > New project (pick the region closest to you).
2. **SQL Editor > New query** — paste all of `supabase/schema.sql` > **Run**. Run it **once** on a fresh project.
3. **Project Settings > API** — copy the Project URL and the `anon` (or `publishable`) key.
4. **Authentication > Providers > Email** — choose how sign-up works:
   - *Confirm email ON* (default): users must click an email link first. Needs reliable email delivery.
   - *Confirm email OFF*: simplest for a small church; the admin's approval step is still required to see data.

### 2. Run locally
```bash
npm install
cp .env.example .env      # then fill in the three values
npm run dev
```
Open the URL shown (http://localhost:5173).

### 3. Create the first account
Click **Sign up** and create your account. **The first account becomes `admin` automatically.**
Everyone after that signs up as `pending`; approve them under **Users** and give them a role.

### 4. Deploy
`npm run build` produces the `dist/` folder. Host it on any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages).
Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_CHURCH_NAME` as **build** environment variables on the host.
Serve over https so the app can be installed on phones ("Add to Home screen") and work offline.

## Roles
| Role | Members / Attendance / Departments / Events | Giving | Users |
|---|---|---|---|
| admin | read, write, delete | read, write, delete | manage |
| finance | read | read, write | — |
| secretary | read, write | no access | — |
| viewer | read | no access | — |
| pending | no access | no access | — |

Deleting is admin-only in every module.

## How offline works (and its limits)
- After you have signed in once online, the app opens offline and shows the last synced data.
- Changes made offline are queued **in this browser** and sent in order when internet returns.
- Conflicts are **last write wins**: if two people edit the same record offline, the later sync overwrites the earlier one.
- If the server rejects a queued change (for example a permission problem), it appears in **Settings** and the screen is refreshed to the server's version.
- Signing out with unsynced changes keeps them on the device; signing out with nothing pending clears the local copy (good for shared phones).
- Clearing browser data while changes are still unsynced loses those changes — sync before you do that.

## Security notes
- Only ever put the **anon/publishable** key in `.env`. Never the `service_role` / secret key.
- Consider turning **off** public sign-ups (Authentication > Sign In / Providers) once your staff have accounts, then add
  people from the Supabase dashboard (Authentication > Users). New users still start as `pending`.
- Member and giving data is personal/financial: use strong passwords and give people the lowest role they need.
- Password reset: use the Supabase dashboard (Authentication > Users) for now; a self-service reset page is not included.

## Project layout
```
supabase/schema.sql   tables, roles, RLS policies, audit trigger
src/data.jsx          local cache + offline queue + sync
src/auth.jsx          login session + role permissions
src/Crud.jsx          one reusable table/form used by 5 modules
src/pages.jsx         Dashboard, modules, Reports, Users, Settings
src/App.jsx           login, approval screen, layout
public/sw.js          offline app shell
```

## Ideas for next steps
Cashbook and weekly cash report, fixed assets with depreciation, member photos, SMS reminders, multiple branches,
an audit-log viewer page, attendance by member ID (instead of typed names), password-reset page.
