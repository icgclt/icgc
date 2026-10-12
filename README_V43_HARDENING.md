# V43 - deployment hardening

- `.gitignore` now excludes `node_modules`, `dist` and `.env*`. `.env.example` lists the variables to set (locally and in Vercel).
- `public/sw.js`, `public/manifest.json`, `public/icon-192.png` and `public/icon-512.png` added. The app shell now loads offline and can be installed to a phone's home screen. Bump `VERSION` in `sw.js` to force devices to refresh their cache.
- The first-login "change your temporary password" flag moved from `user_metadata` to `app_metadata`.

## To apply
1. Run `supabase/migration_43_must_change_password_app_metadata.sql` in the Supabase SQL editor.
2. Redeploy the edge function: `supabase functions deploy create-member-portal-user`.
3. Push to GitHub; Vercel redeploys. Do this in order: migration and function first, then the website.
