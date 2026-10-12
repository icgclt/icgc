# V40.7 — Offline Startup Cache + Attendance Date/Event Fix

Changes in this build:

1. Offline-first startup now persists all table caches in localStorage so previously synced data can be displayed immediately when the app opens again. Sensitive tables previously stored in sessionStorage are migrated to persistent localStorage when available.
2. The app continues background synchronization when internet is available, replacing the cached data with the latest server data after a successful pull.
3. Headcount Attendance defaults to today's date and automatically suggests the event scheduled for that date. The day of week is shown next to the date.
4. Quick Attendance defaults to today's date and automatically selects an upcoming event scheduled for today. If there is no event for the date, common weekday service defaults are used instead of always assuming Sunday Service.
5. Existing saved records are not silently rewritten. To correct an already-saved wrong service/date record, select the correct event/service and save the correct record; the old record should be reviewed/removed separately if it was entered incorrectly.
