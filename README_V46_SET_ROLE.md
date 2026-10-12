# V46 - fix role assignment on the Users page

The Users page sends a `set_role` request to the `admin-users` edge function, but that function had no `set_role` handler, so every role change failed with "Unknown action."

Redeploy it: `npx supabase functions deploy admin-users` (or paste `supabase/functions/admin-users/index.ts` into the function editor in the Supabase dashboard and click Deploy). No website redeploy is needed.

Rules enforced on the server: only admins can change roles; nobody can change their own role; only a Super Admin can grant or change the Super Admin role; the role must exist in the role catalogue.
The change is made as the signed-in admin, so the Audit Log shows who changed the role.
