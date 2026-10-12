# V40-10 Member Portal Edge Function Fix

## What was fixed
The Member Portal Account UI was working, but clicking **Create / Reset Portal Password** returned:
`Edge Function returned a non-2xx status code`.

The deployed Edge Function was checking only `admin` and `secretary` roles. The application correctly treats `super_admin` as a fully privileged role, so Super Admin was being rejected by the function.

The function now allows:
- `super_admin`
- `admin`
- `secretary`

No database migration is required for this fix.

## Deploy the Edge Function
From the project root, after linking the correct Supabase project:

```cmd
npx supabase functions deploy create-member-portal-user
```

Then reload the app and try **Create / Reset Portal Password** again.

## Important
This fix must be deployed to Supabase because Edge Functions run on Supabase. Updating only the Vercel frontend will not update the server-side function.
