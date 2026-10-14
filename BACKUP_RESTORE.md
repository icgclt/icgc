# Backup & Restore (V61)

Works the same in ICGC Testimony Temple (TT) and ICGC Dominion Temple (DT). Each church has its own Supabase
project, so do the one-time setup **once per church**.

## One-time setup (5 minutes, per church)
1. Open that church's Supabase project -> **SQL Editor**.
2. Paste the contents of `supabase/migration_61_backup_restore.sql` and press **Run**. (Safe to run again.)
3. Rebuild/redeploy the app (`npm run build`, then your normal Vercel deploy).
4. Sign in as an administrator -> **Settings -> Backup & Restore**. "Automatic server snapshots" should now list an
   "Initial snapshot".

Without step 2 the app still lets you download backups and do a *basic* restore (see "Limits"), but you will not get
automatic snapshots, the all-or-nothing restore, or restore of locked finance records.

## What you get
| Feature | What it does |
|---|---|
| **Download full backup** | Reads every table straight from the server (not the phone's offline copy), checks the row counts against the server, adds SHA-256 checksums and saves one compressed file (`icgc-tt-backup-20261013-2321.json.gz`). If any table cannot be read it stops - you never get a silently incomplete backup. |
| **Automatic nightly snapshots** | Every night at 01:00 (Ghana time) the database saves a full snapshot of itself (skipped if nothing changed; last 14 kept). It is your "undo" for accidents - e.g. someone deleting records or running *Clear Test Data*. |
| **Snapshot before every restore / clear** | A snapshot is taken automatically before any restore and before *Clear Test Data*, so both can be undone. |
| **Restore with preview** | Choose a file (or a snapshot), see it verified (checksums, church/project match), pick which tables to restore, press *Preview changes* to see exactly how many records will be added / changed / deleted - then confirm by typing `RESTORE`. |
| **All-or-nothing** | The whole restore runs as one database transaction. It either completes entirely or changes nothing. |
| **Finance records restore exactly** | Locked/approved/submitted finance records are brought back as they were (the normal finance-lock rules would otherwise reject them). The bypass exists only inside the restore transaction. |
| **Wrong-church protection** | A TT file opened in the DT app (or the reverse) is detected from the member IDs / Supabase project and blocked unless you tick an explicit acknowledgement. |
| **Old backups still work** | Files from the previous "Download JSON backup" button can be restored (they have no checksums, so they cannot be verified). |

## Restore modes
* **Merge (recommended):** puts back anything that is missing and resets changed records to the backup version.
  Records created *after* the backup are kept.
* **Exact copy:** makes the selected tables identical to the backup. Records created after the backup are **deleted**,
  together with anything that depends on them. Use only for full disaster recovery. It can be undone from the
  pre-restore snapshot.

## Typical situations
* **Someone deleted members/attendance by mistake:** Settings -> Backup & Restore -> pick last night's snapshot ->
  *Restore...* -> untick everything except the affected tables -> *Merge* -> Preview -> type RESTORE.
* **Test data cleared too early:** restore the "Before clearing test data" snapshot in *Merge* mode.
* **Moving to a new Supabase project:** run the setup SQL files in the new project, create the administrator, then
  restore the downloaded file. (Links to deleted login accounts - `created_by`, a member's `user_id` - are cleared
  automatically; re-create portal logins from the Members screen.)
* **Supabase project lost:** the downloaded files are your only copy. Keep them OUTSIDE the phone/PC they were made on.

## What is NOT included (important)
* **Login accounts, roles and permissions** (Supabase Auth, `profiles`, role tables). Restoring them from a file
  could silently hand out admin rights, so they are never touched. Recreate users from the Users screen.
* **Member photos** (files in Supabase Storage). Records keep the photo link, but the image files are not in the backup.
* **Audit log** (it purges itself after 30 days) and Edge Function secrets/keys.
* Snapshots live in the **same database** as the live data - they protect against mistakes, not against losing the
  Supabase project. Download a file backup at least weekly (the app reminds you after 7 days).

## Limits / things to know
* Basic mode (migration not installed): add/update only, finance-locked tables are skipped, and a failure part-way can
  leave a partial restore. Install migration 61 to avoid this.
* In *Merge* mode, if the backup holds an attendance record for a person/day that already exists under a different
  record ID, the database refuses it (one attendance per person per day) and the whole restore is rolled back with a
  message naming the table. Use *Exact copy* for that table, or restore into an emptied table.
* While a restore runs, other users may wait a few seconds (the affected tables are briefly locked).
* Restoring requires an administrator or super administrator, an internet connection, and no unsynced offline changes
  on the device (sync first).
* Please test once on a copy first: create a test snapshot, change a record, restore the snapshot in *Merge* mode,
  and confirm the record returns.
