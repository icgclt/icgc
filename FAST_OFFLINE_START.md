# Fast offline start (round 3)

**Problem:** with no internet the app sat on "Loading…" for about 32 seconds before showing anything.

**Cause:** on start-up the app asked Supabase for the saved login (`getSession()`). If the access token had expired,
Supabase tries to refresh it, and with no connection it retries with growing pauses for ~30 seconds. Nothing was shown
until that finished, and every data request queued behind it as well.

**Fix (all in `src/auth.jsx`):**
- Offline: the app opens at once from the login, profile and permissions already saved on the device. Supabase is still
  asked in the background; if it later returns a real session, profile and permissions are refreshed quietly.
- "Online" but the connection is dead or very weak: after 3 seconds the app stops waiting and opens from the saved copy.
- A failed refresh with no internet no longer signs the user out of a device opened from its saved copy.
  A genuine sign-out (login revoked) still does.
- Sign-in on a dead connection: waits 6 s (20 s if this device has no saved sign-in) instead of the browser's long timeout,
  then uses the saved offline sign-in.
- Sign-out now also removes the login saved on the device when offline, otherwise the app would reopen signed in.
- A failed permissions read keeps the permissions saved on the device instead of emptying the menu, and a successful read refreshes that copy.

**Needs one earlier online sign-in on the device** so the profile and permissions copy exists. Without it, the app falls back to the sign-in screen
(which now appears after 3 s, and offline sign-in works as before).

**Not tested:** Vite was not run here (no network); `auth.jsx` was syntax-checked only. Test on a phone: sign in online, open the app, switch to
airplane mode, close and reopen it.
