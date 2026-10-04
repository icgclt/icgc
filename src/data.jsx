import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { loadTableCaches, persistCache, deleteCache } from './offlineStore';

export const TABLES = [
  'members', 'attendance', 'attendance_headcount', 'giving', 'departments', 'events',
  'welfare_members', 'offering_entries', 'member_contributions', 'welfare_transactions',
  'visitors', 'groups', 'follow_ups', 'prayer_requests', 'service_plans', 'pastoral_cases', 'event_registrations', 'announcements', 'families', 'children', 'child_checkins', 'department_members', 'group_members', 'group_attendance', 'pledges', 'payment_receipts', 'communication_templates', 'communication_queue', 'finance_reconciliations', 'notification_campaigns', 'notification_logs', 'payment_requests', 'payment_webhook_events', 'member_notification_preferences', 'member_group_history', 'abc_class_attendance', 'finance_weekly_reports', 'finance_weekly_cash_counts', 'finance_weekly_momo', 'finance_weekday_collections', 'finance_weekday_cash_counts', 'finance_weekday_momo',
];

// Offline-first storage: every table is persisted so the phone can reopen with the last
// known data immediately. The app still syncs with Supabase when connectivity returns.
const BRANCH_SCOPED_TABLES = new Set();

const SENSITIVE_TABLES = new Set([
  'giving', 'offering_entries', 'member_contributions', 'welfare_transactions',
]);
const read = (k, d, storage = localStorage) => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v, storage = localStorage) => { try { storage.setItem(k, JSON.stringify(v)); return true; } catch { /* storage full/blocked */ return false; } };
const removeStored = (k, storage = localStorage) => { try { storage.removeItem(k); } catch { /* ignore */ } };
const SERVER_FIELDS = ['created_at', 'updated_at', 'created_by'];

const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

// PostgREST returns at most 1000 rows per request, so page through everything.
async function fetchAll(table) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from(table).select('*')
      .order('created_at').order('id')
      .range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

// Light sync. These tables have a database trigger that refreshes updated_at on every edit, so after the
// first full download a device only asks for rows changed since its last sync. (Tables not listed here
// have no such trigger, so they are still downloaded in full each time, as before.)
const INCREMENTAL_TABLES = new Set([
  'members', 'attendance', 'attendance_headcount', 'giving', 'departments', 'events',
  'welfare_members', 'offering_entries', 'member_contributions', 'welfare_transactions',
  'visitors', 'groups', 'follow_ups', 'prayer_requests', 'service_plans', 'pastoral_cases',
  'member_notification_preferences',
]);
const OVERLAP_MS = 5 * 60 * 1000;        // re-ask for the last 5 minutes so a slow commit is never missed
const RECONCILE_MS = 60 * 60 * 1000;     // deleted rows are noticed by an ids-only check at most once an hour
const ts = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n; };
const maxUpdated = (rows, start = null) => rows.reduce((m, r) => (r.updated_at && (!m || ts(r.updated_at) > ts(m)) ? r.updated_at : m), start);
const byCreated = (a, b) => (ts(a.created_at) - ts(b.created_at)) || String(a.id).localeCompare(String(b.id));

async function fetchChanged(table, sinceIso) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from(table).select('*')
      .gte('updated_at', sinceIso)
      .order('updated_at').order('id')
      .range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function fetchIds(table) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select('id').order('id').range(from, from + size - 1);
    if (error) throw error;
    out.push(...data.map((r) => r.id));
    if (data.length < size) break;
  }
  return out;
}

const isTransient = (error, status) =>
  status === 0 || status >= 500 || !error?.code || String(error.code).startsWith('PGRST3');

// Updates/deletes are conditional on the version the user originally edited. This prevents a
// stale browser from silently overwriting another user's newer change.
async function send(op) {
  try {
    if (op.op === 'delete') {
      let query = supabase.from(op.table).delete().eq('id', op.id);
      if (op.expectedUpdatedAt) query = query.eq('updated_at', op.expectedUpdatedAt);
      const { data, error, status } = await query.select('id');
      if (!error && op.expectedUpdatedAt && data?.length === 0) {
        return { error: { message: 'Conflict: this record was changed by another user.', code: 'CONFLICT' }, status: 409, conflict: true };
      }
      return { error, status };
    }

    const row = { ...op.row };
    SERVER_FIELDS.forEach((k) => delete row[k]);

    if (op.expectedUpdatedAt) {
      const { data, error, status } = await supabase
        .from(op.table)
        .update(row)
        .eq('id', op.row.id)
        .eq('updated_at', op.expectedUpdatedAt)
        .select('*');
      if (!error && (!data || data.length === 0)) {
        return { error: { message: 'Conflict: this record was changed by another user.', code: 'CONFLICT' }, status: 409, conflict: true };
      }
      return { error, status, data: data?.[0] };
    }

    const { data, error, status } = await supabase.from(op.table).upsert(row).select('*').single();
    return { error, status, data };
  } catch (e) {
    return { error: { message: String(e?.message || e), code: '' }, status: 0 };
  }
}

const activeTablesFor = (role) => role === 'member' ? ['members','attendance','giving','events','prayer_requests','announcements','payment_requests','payment_receipts','member_notification_preferences'] : TABLES;

// The offline copy lives in IndexedDB, which can only be read asynchronously, so load it first and
// then start the real provider with it. This takes a fraction of a second.
export function DataProvider({ uid, role, children }) {
  const key = `${uid}|${role}`;
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let alive = true;
    loadTableCaches((t) => `cm:${uid}:cache:${t}`, activeTablesFor(role), SENSITIVE_TABLES)
      .then((initial) => { if (alive) setLoaded({ key, initial }); });
    return () => { alive = false; };
  }, [key]);
  if (!loaded || loaded.key !== key) {
    return <div className="login"><div className="loginbox"><p className="muted">Loading…</p></div></div>;
  }
  return <DataProviderInner key={key} uid={uid} role={role} initial={loaded.initial}>{children}</DataProviderInner>;
}

function DataProviderInner({ uid, role, initial, children }) {
  const ACTIVE_TABLES = activeTablesFor(role);
  const ck = (t) => `cm:${uid}:cache:${t}`;
  const okey = `cm:${uid}:outbox`;
  const skey = `cm:${uid}:sensitive-outbox`;
  const fkey = `cm:${uid}:failed`;
  const sfkey = `cm:${uid}:sensitive-failed`;
  const sensitiveStorage = localStorage;

  const [data, setData] = useState(initial); 
  const dataRef = useRef(data);
  const initialPersistentOutbox = read(okey, []);
  const legacySensitive = initialPersistentOutbox.filter((op) => SENSITIVE_TABLES.has(op.table));
  if (legacySensitive.length) {
    write(skey, legacySensitive, sensitiveStorage);
    write(okey, initialPersistentOutbox.filter((op) => !SENSITIVE_TABLES.has(op.table)));
  }
  const outboxRef = useRef([...read(okey, []), ...read(skey, [], sensitiveStorage)]);
  const failedRef = useRef([...read(fkey, []), ...read(sfkey, [], sensitiveStorage)]);
  const [pending, setPending] = useState(outboxRef.current.length);
  const [failed, setFailed] = useState(failedRef.current);
  const [online, setOnline] = useState(navigator.onLine);
  const [syncError, setSyncError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const busy = useRef(false);
  const again = useRef(false);
  const pullAgain = useRef(false);
  const syncRef = useRef(null);
  const wmk = (t) => `cm:${uid}:wm:${t}`;
  const forceReconcile = useRef(false);
  const lastReconcile = useRef(0);
  // Sync position per table. Only trusted when that table's saved copy is also on this device.
  const wmRef = useRef(null);
  if (wmRef.current === null) {
    wmRef.current = {};
    ACTIVE_TABLES.forEach((t) => {
      if (!INCREMENTAL_TABLES.has(t)) return;
      const w = read(wmk(t), null);
      if (w && (data[t] || []).length) wmRef.current[t] = w;
    });
  }

  // Saving the offline copy is slightly delayed so a burst of edits is written once.
  const pendingSave = useRef({});
  const saveTimers = useRef({});
  const flushSave = (table) => {
    clearTimeout(saveTimers.current[table]);
    if (!(table in pendingSave.current)) return;
    const rows = pendingSave.current[table];
    delete pendingSave.current[table];
    persistCache(ck(table), rows);
  };
  const queueSave = (table, rows) => {
    pendingSave.current[table] = rows;
    clearTimeout(saveTimers.current[table]);
    saveTimers.current[table] = setTimeout(() => flushSave(table), 150);
  };
  const dropPendingSaves = () => {
    Object.values(saveTimers.current).forEach(clearTimeout);
    pendingSave.current = {};
  };
  const commit = (table, rows) => {
    dataRef.current = { ...dataRef.current, [table]: rows };
    queueSave(table, rows);
    setData(dataRef.current);
  };
  const persistOutbox = (o) => {
    write(okey, o.filter((op) => !SENSITIVE_TABLES.has(op.table)));
    write(skey, o.filter((op) => SENSITIVE_TABLES.has(op.table)), sensitiveStorage);
  };
  const persistFailed = (items) => {
    write(fkey, items.filter((op) => !SENSITIVE_TABLES.has(op.table)));
    write(sfkey, items.filter((op) => SENSITIVE_TABLES.has(op.table)), sensitiveStorage);
  };
  const setOutbox = (o) => { outboxRef.current = o; persistOutbox(o); setPending(o.length); };
  const addFailed = (f) => { failedRef.current = [...failedRef.current, f]; persistFailed(failedRef.current); setFailed(failedRef.current); };

  async function sync(pull = false) {
    if (!navigator.onLine) return;
    if (busy.current) { again.current = true; pullAgain.current = pullAgain.current || pull; return; }
    busy.current = true;
    setSyncing(true);
    try {
      let hadFailure = false;
      while (outboxRef.current.length) {
        const op = outboxRef.current[0];
        const result = await send(op);
        const { error, status } = result;
        if (error && isTransient(error, status)) { setSyncError(true); break; }
        if (error) {
          hadFailure = true;
          addFailed({ ...op, error: error.message, at: new Date().toISOString(), conflict: !!result.conflict });
        } else if (result.data && op.op === 'upsert') {
          // Replace optimistic metadata with the server's trigger-generated timestamps.
          const rows = dataRef.current[op.table] || [];
          commit(op.table, rows.map((r) => r.id === op.row.id ? { ...r, ...result.data } : r));
          // If the same record was edited more than once while offline, later queued edits
          // should build on this successful server version instead of falsely conflicting.
          outboxRef.current = outboxRef.current.map((queued, index) =>
            index > 0 && queued.table === op.table && queued.row?.id === op.row.id
              ? { ...queued, expectedUpdatedAt: result.data.updated_at }
              : queued
          );
        }
        setOutbox(outboxRef.current.slice(1));
      }
      if ((pull || hadFailure) && outboxRef.current.length === 0) {
        const before = dataRef.current;
        const next = {};
        const wm = { ...wmRef.current };
        const reconcile = forceReconcile.current || Date.now() - lastReconcile.current > RECONCILE_MS;
        for (const t of ACTIVE_TABLES) {
          const cached = before[t] || [];
          if (!INCREMENTAL_TABLES.has(t) || !wm[t] || !cached.length) {
            next[t] = await fetchAll(t);
            if (INCREMENTAL_TABLES.has(t)) { const m = maxUpdated(next[t]); if (m) wm[t] = m; else delete wm[t]; }
            continue;
          }
          const changed = await fetchChanged(t, new Date(ts(wm[t]) - OVERLAP_MS).toISOString());
          let rows = cached;
          if (changed.length) {
            const byId = new Map(rows.map((r) => [r.id, r]));
            let added = false;
            let touched = false;
            changed.forEach((r) => {
              const old = byId.get(r.id);
              if (!old) added = true;
              if (!old || old.updated_at !== r.updated_at) { touched = true; byId.set(r.id, r); } // overlap rows we already hold are skipped
            });
            if (touched) {
              rows = [...byId.values()];
              if (added) rows.sort(byCreated);
            }
            wm[t] = maxUpdated(changed, wm[t]);
          }
          if (reconcile) {
            const live = new Set(await fetchIds(t));
            if (rows.some((r) => !live.has(r.id))) rows = rows.filter((r) => live.has(r.id));
          }
          next[t] = rows;
        }
        if (outboxRef.current.length === 0) {
          dataRef.current = next;
          wmRef.current = wm;
          setData(next);
          setLastSync(new Date());
          if (reconcile) { lastReconcile.current = Date.now(); forceReconcile.current = false; }
          // Save the offline copy after the screen is updated. Save the newest in-memory rows, so an edit
          // made while this runs is not overwritten with an older copy.
          for (const t of ACTIVE_TABLES) {
            if (next[t] === before[t]) continue; // nothing changed for this table
            delete pendingSave.current[t];
            const saved = await persistCache(ck(t), dataRef.current[t]);
            if (INCREMENTAL_TABLES.has(t)) { if (saved && wm[t]) write(wmk(t), wm[t]); else removeStored(wmk(t)); }
          }
          setSyncError(false);
        }
      } else if (outboxRef.current.length === 0) {
        setSyncError(false);
        setLastSync(new Date());
      }
    } catch {
      setSyncError(true);
    } finally {
      busy.current = false;
      setSyncing(false);
      if (again.current) {
        again.current = false;
        const p = pullAgain.current;
        pullAgain.current = false;
        setTimeout(() => syncRef.current(p), 0);
      }
    }
  }
  syncRef.current = sync;

  useEffect(() => {
    const on = () => { setOnline(true); syncRef.current(true); };
    const off = () => setOnline(false);
    const vis = () => { if (!document.hidden) syncRef.current(true); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    document.addEventListener('visibilitychange', vis);
    const flushAll = () => Object.keys(pendingSave.current).forEach(flushSave);
    const hide = () => { if (document.hidden) flushAll(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', flushAll);
    // Full-table polling is expensive; five minutes is enough because manual sync and the
    // online/visibility events still provide immediate refreshes.
    const iv = setInterval(() => { if (!document.hidden) syncRef.current(true); }, 300000);
    syncRef.current(true);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
      clearInterval(iv);
    };
  }, []);

  const save = (table, row) => {
    const list = dataRef.current[table] || [];
    const scopedRow = row;

    // Attendance is intentionally limited to one record per person per calendar day.
    // The check happens against the local cache first so the rule also works offline.
    // Editing the exact same record remains allowed.
    if (table === 'attendance' && scopedRow?.date) {
      const rowDate = String(scopedRow.date).slice(0, 10);
      let identityField = scopedRow.member_id ? 'member_id' : scopedRow.child_id ? 'child_id' : 'person_name';
      let identity = identityField === 'person_name'
        ? String(scopedRow.person_name || '').trim().toLowerCase()
        : scopedRow[identityField];

      // Older/manual attendance rows may not carry member_id/child_id. When possible,
      // resolve the person's name against the local member/child cache before falling
      // back to a name comparison.
      if (identityField === 'person_name' && identity) {
        const memberMatch = (dataRef.current.members || []).find(m => String(m.name || '').trim().toLowerCase() === identity);
        const childMatch = (dataRef.current.children || []).find(c => String(c.name || '').trim().toLowerCase() === identity);
        if (memberMatch) { identityField = 'member_id'; identity = memberMatch.id; }
        else if (childMatch) { identityField = 'child_id'; identity = childMatch.id; }
      }

      if (identity) {
        const duplicate = list.find((x) => {
          if (x.id === scopedRow.id || String(x.date || '').slice(0, 10) !== rowDate) return false;
          if (identityField === 'person_name') return String(x.person_name || '').trim().toLowerCase() === identity;
          return x[identityField] === identity || (!x.member_id && !x.child_id && String(x.person_name || '').trim().toLowerCase() === String(scopedRow.person_name || '').trim().toLowerCase());
        });
        if (duplicate) {
          return {
            ok: false,
            duplicate: true,
            error: {
              code: 'DUPLICATE_ATTENDANCE',
              message: `${scopedRow.person_name || 'This person'} is already marked for ${rowDate}. Attendance can only be marked once per person per day.`,
            },
          };
        }
      }
    }

    const existing = list.find((x) => x.id === scopedRow.id);
    const optimistic = existing
      ? { ...existing, ...scopedRow }
      : { created_at: new Date().toISOString(), ...scopedRow };
    commit(table, existing ? list.map((x) => (x.id === scopedRow.id ? optimistic : x)) : [...list, optimistic]);
    setOutbox([...outboxRef.current, {
      op: 'upsert', table, row: scopedRow,
      expectedUpdatedAt: existing?.updated_at || null,
    }]);
    syncRef.current(false);
    return { ok: true, row: optimistic };
  };

  const remove = (table, id) => {
    const existing = dataRef.current[table].find((x) => x.id === id);
    commit(table, dataRef.current[table].filter((x) => x.id !== id));
    setOutbox([...outboxRef.current, { op: 'delete', table, id, expectedUpdatedAt: existing?.updated_at || null }]);
    syncRef.current(false);
  };

  const discardFailed = () => { failedRef.current = []; write(fkey, []); write(sfkey, [], sensitiveStorage); setFailed([]); };

  const wipe = () => {
    dropPendingSaves();
    ACTIVE_TABLES.forEach((t) => { deleteCache(ck(t)); removeStored(wmk(t)); });
    removeStored(okey);
    removeStored(skey, sensitiveStorage);
    removeStored(fkey);
    removeStored(sfkey, sensitiveStorage);
    removeStored(`cm:profile:${uid}`);
  };

  const clearTestData = async () => {
    const { error } = await supabase.rpc('clear_test_data');
    if (error) throw error;
    outboxRef.current = [];
    failedRef.current = [];
    persistOutbox([]);
    persistFailed([]);
    setPending(0);
    setFailed([]);
    const empty = Object.fromEntries(ACTIVE_TABLES.map((t) => [t, []]));
    dataRef.current = empty;
    dropPendingSaves();
    ACTIVE_TABLES.forEach((t) => { deleteCache(ck(t)); removeStored(wmk(t)); });
    setData(empty);
    setLastSync(new Date());
  };

  const value = {
    data, save, remove, wipe, clearTestData, discardFailed,
    pending, failed, online, syncError, syncing, lastSync,
    syncNow: () => { forceReconcile.current = true; return syncRef.current(true); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
