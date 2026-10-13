# Send SMS is now a permission

Send SMS can be given to the Pastor, or any other role, from the **Role Permissions** screen.

## How to give the Pastor SMS access
1. Run `supabase/migration_59_sms_permission.sql` once (Supabase SQL Editor). Admin and Secretary keep SMS.
2. Sign in as Super Admin > Role Permissions > choose **Pastor** > tick **Send SMS** > Save.
3. The Pastor sees Send SMS in the menu the next time the app is opened or comes back into focus.

To remove it later, untick the box and save. Nothing is hard-coded to a role any more.

## What changed
- The menu item and the Send SMS page follow the `sms.send` permission.
- The `send-sms` Edge Function checks the same permission on the server. Redeploy it: `supabase functions deploy send-sms`.
  Until migration 59 has been run the function behaves as before (Admin and Secretary only).
- Each send writes a line to the function log with who sent it and how many recipients (SMS credit costs money).
- The earlier approach, which always allowed the Pastor and could not be switched off, was removed.

Test with a number you control before sending to a group.
