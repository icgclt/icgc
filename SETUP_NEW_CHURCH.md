# Setting up another church (example: ICGC Dominion Temple, Duayaw Nkwanta)

Each church gets its **own** Supabase project (its own database and logins) and its **own** Vercel site.
Both sites are built from the same GitHub code, so a future update is one push.

## 1. Supabase (the new church's own project)
1. Supabase > create a **new organization** (free) for the church, then a **new project** in it. Save the database password.
   A separate organization gives the church its own monthly data allowance.
2. **Database > Extensions**: search `pg_cron` and enable it.
3. **SQL Editor**. Run the setup either way:
   - **In 7 parts (recommended):** run `dominion_setup_part_1_of_7.sql`, then part 2, and so on, each pasted into its own **New query**. Each part is all-or-nothing, so if one fails you only repeat that part after it is fixed; send the part number and the error.
   - **As one file:** paste all of `setup_dominion_temple.sql` and click **Run**. If it fails, nothing is installed.
   - Success looks like "Success. No rows returned".
4. **Authentication > URL Configuration**: set **Site URL** to the new Vercel address once you have it (step 3).
5. **Project Settings > API**: copy the project URL and the key (use the same kind of key you use for Testimony Temple).

## 2. Edge functions (for the new project)
From the project folder, in a terminal:
```
npx supabase login
npx supabase link --project-ref NEW_PROJECT_REF
npx supabase functions deploy admin-users --no-verify-jwt
npx supabase functions deploy create-member-portal-user --no-verify-jwt
```
`NEW_PROJECT_REF` is the code in the new project's dashboard address. These two are needed for the Users page and member portal logins.
Only if the church will use SMS or online payments, also deploy `send-sms`, `notification-worker`, `paystack-charge` and `paystack-webhook`
(the webhook always with `--no-verify-jwt`) and add their secrets under **Edge Functions > Secrets**:
`SMSONLINEGH_API_KEY`, `SMSONLINEGH_SENDER_ID`, `PAYSTACK_SECRET_KEY`, `NOTIFICATION_CRON_SECRET`.
Afterwards run `npx supabase link --project-ref` with Testimony Temple's code again before deploying anything for that church.

## 3. Vercel (the new site)
1. Vercel > **Add New > Project** > import the same GitHub repository.
2. Under **Environment Variables** add:
   - `VITE_SUPABASE_URL` = the new project's URL
   - `VITE_SUPABASE_ANON_KEY` = the new project's key
   - `VITE_CHURCH_NAME` = `ICGC Dominion Temple, Duayaw Nkwanta`
   - `VITE_MEMBER_CODE_PREFIX` = `DT`
3. Deploy. Then put the new address in Supabase's Site URL (step 1.4).

## 4. First login
The **first account** created in a new project becomes the Super Admin. Have the church's lead admin open the new site and sign up first,
then check **Users** shows them as `super_admin`. Create everyone else from **Users > + Create user**.
Before sharing the address widely, turn off public sign-ups in **Authentication > Sign In / Providers** if you do not want strangers creating accounts.

## 5. After setup
- Members get IDs DTA1, DTO1, DTC1 and so on.
- Role access starts as a copy of Testimony Temple's defaults; the Super Admin can change it in Role Permissions.
- Every future SQL migration must be run in **each** church's Supabase project. Website updates reach both sites from one GitHub push.
- Open the app online once on each phone after setup so it can work offline.
