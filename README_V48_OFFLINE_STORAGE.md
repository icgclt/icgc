# V48 - offline copy moved to IndexedDB

The offline copy of the church data used to live in the browser's local storage, which holds only a few MB.
It now lives in IndexedDB (`src/offlineStore.js`), which holds hundreds of MB, so a large attendance table no longer
risks failing to save.

- No database change and no edge function change. Push the website to GitHub so Vercel redeploys.
- The first time each device opens the new version, its existing offline copy is moved across automatically
  and the old copy is removed. No data is lost and nothing needs to be downloaded again.
- If a browser does not allow IndexedDB (some private-browsing modes), the app falls back to local storage as before.
- The offline copy is now written a fraction of a second after an edit, and again when the app is closed or hidden.
  Edits themselves are queued separately and are not affected.
- A short "Loading..." screen shows while the offline copy is read when the app starts.
