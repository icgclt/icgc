# v40.5 Offline Login Fix

Previously authenticated users can now sign in on a device while offline.

- Successful online sign-in stores a device-local PBKDF2 password verifier, cached profile, and cached permission keys.
- Offline sign-in verifies the entered password locally and restores the cached user/profile/permissions without contacting Supabase.
- The existing DataProvider offline cache/outbox continues to handle local data and synchronization when connectivity returns.
- A brand-new device/account that has never completed an online sign-in cannot authenticate offline; it must first establish its local credential cache online.
- Passwords are never stored in localStorage; only a salted PBKDF2 verifier is stored.
