# V42 Attendance rule

- Attendance is limited to one marking per member/child per calendar day.
- The app checks the local cache first, so the rule works while offline.
- A person already marked today in another service/event is shown as **Already marked today** and cannot be selected again.
- Existing attendance records can still be edited when they are the current record.
- `supabase/migration_42_attendance_once_per_day.sql` adds database-level protection for linked member/child records.
- Member Portal home no longer shows the **Pending** Member ID card. The Member ID remains available on the Profile tab.
