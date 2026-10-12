# v40.8 Phone Login / Network Failure Fix

- Keeps v40.7 offline startup and date/event behavior.
- If a phone reports itself online but Supabase login returns a network/fetch failure, the app now attempts the saved offline credential instead of displaying the raw `Failed to fetch` error.
- If the device has never successfully signed in online before, a secure offline credential cannot exist yet; the user must first complete one successful online sign-in on that device.
- Invalid passwords are still rejected normally and are not treated as offline/network failures.
