V40.4 changes:
- Adds Sunday School Teacher as a role group.
- Adds extensible custom role groups from Role Permissions.
- Custom roles choose a base database access template and then use the existing permission checkboxes.
- User Management can assign any role in role_catalog.
- Login gives a clear offline/network message instead of exposing raw "Failed to fetch".
- Apply supabase/migration_41_custom_roles.sql before using custom roles.
- Redeploy supabase/functions/admin-users after updating the Edge Function.
