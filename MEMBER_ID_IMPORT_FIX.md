# Member import: duplicate IDs and damaged phone numbers

## What went wrong
Every row of a bulk upload asked for "the next ID" from the same unchanged member list, so all new members were given
the same ID (for example 54 people all became TTA6). Excel also damaged phone numbers: it removed the leading 0
(0244123456 became 244123456) and turned some into scientific notation (2.43E+08), which loses the digits.

An earlier note in this project said the importer had been fixed, but the importer code in that upload was unchanged.
The fix below is in `src/pages.jsx` (`MemberImport`).

## What the importer does now
- Keeps a working list that grows as members are added, so every new member gets the next free TTA / TTO / TTC ID.
- A Member ID written in the file is used when it is free. If it already belongs to someone else, a new ID is given and the person is listed in the result message.
- A row updates an existing member when the Member ID matches, or the name matches and the phone does not point to a different person. Two different people with the same first name are no longer merged.
- Restores a missing leading 0, converts 233... and +233... numbers, and reports numbers Excel destroyed (left blank, listed by name).
- Understands dates written DD/MM/YYYY and reports dates it cannot read.
- Shows a plain summary after each import.

## Database steps (in this order, after taking a backup)
1. `supabase/maintenance_preview_duplicate_member_codes.sql` (read-only) to see any duplicates.
2. `supabase/maintenance_repair_duplicate_member_codes.sql` to give the duplicates new IDs. It now stops and changes nothing if any duplicate remains.
3. `supabase/migration_60_unique_member_code.sql` so the database refuses duplicate IDs from now on.
4. `supabase/maintenance_fix_member_phones.sql` to repair numbers already damaged. Read its preview first. Numbers shown like 2.43E+08 cannot be recovered and must be typed in again.

## Tip for Excel files
Format the phone column as Text before typing or pasting numbers, and save as CSV UTF-8.
