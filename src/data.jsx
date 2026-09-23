import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export const TABLES = [
  'members', 'attendance', 'attendance_headcount', 'giving', 'departments', 'events',
  'welfare_members', 'offering_entries', 'member_contributions', 'welfare_transactions',
  'visitors', 'groups', 'follow_ups', 'prayer_requests', 'volunteers', 'service_plans', 'pastoral_cases', 'event_registrations', 'announcements',
];

// Financial records use sessionStorage rather than localStorage. This keeps sensitive giving/welfare
// data out of the persistent browser profile while still allowing offline work during the session.
const SENSITIVE_TABLES = new Set([
  'giving', 'offering_entries', 'member_contributions', 'welfare_transactions',
]);
const shouldPersist = (table) => !SENSITIVE_TABLES.has(table);
const storageForTable = (table) => SENSITIVE_TABLES.has(table) ? sessionStorage : localStorage;
const read = (k, d, storage = localStorage) => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v, storage = localStorage) => { try { storage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ } };
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

export function DataProvider({ uid, role, children }) {
  const ACTIVE_TABLES = role === 'member' ? ['members','attendance','giving','events','prayer_requests','event_registrations','announcements'] : TABLES;
  const ck = (t) => `cm:${uid}:cache:${t}`;
  const okey = `cm:${uid}:outbox`;
  const skey = `cm:${uid}:sensitive-outbox`;
  const fkey = `cm:${uid}:failed`;
  const sfkey = `cm:${uid}:sensitive-failed`;
  const sensitiveStorage = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;

  const [data, setData] = useState(() => Object.fromEntries(ACTIVE_TABLES.map((t) => [t, read(ck(t), [], storageForTable(t))])));
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

  const commit = (table, rows) => {
    dataRef.current = { ...dataRef.current, [table]: rows };
    write(ck(table), rows, storageForTable(table));
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
        const next = {};
        for (const t of ACTIVE_TABLES) next[t] = await fetchAll(t);
        if (outboxRef.current.length === 0) {
          dataRef.current = next;
          ACTIVE_TABLES.forEach((t) => write(ck(t), next[t], storageForTable(t)));
          setData(next);
          setLastSync(new Date());
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
    // Full-table polling is expensive; five minutes is enough because manual sync and the
    // online/visibility events still provide immediate refreshes.
    const iv = setInterval(() => { if (!document.hidden) syncRef.current(true); }, 300000);
    syncRef.current(true);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
      clearInterval(iv);
    };
  }, []);

  const save = (table, row) => {
    const list = dataRef.current[table];
    const existing = list.find((x) => x.id === row.id);
    const optimistic = existing
      ? { ...existing, ...row }
      : { created_at: new Date().toISOString(), ...row };
    commit(table, existing ? list.map((x) => (x.id === row.id ? optimistic : x)) : [...list, optimistic]);
    setOutbox([...outboxRef.current, {
      op: 'upsert', table, row,
      expectedUpdatedAt: existing?.updated_at || null,
    }]);
    syncRef.current(false);
  };

  const remove = (table, id) => {
    const existing = dataRef.current[table].find((x) => x.id === id);
    commit(table, dataRef.current[table].filter((x) => x.id !== id));
    setOutbox([...outboxRef.current, { op: 'delete', table, id, expectedUpdatedAt: existing?.updated_at || null }]);
    syncRef.current(false);
  };

  const discardFailed = () => { failedRef.current = []; write(fkey, []); write(sfkey, [], sensitiveStorage); setFailed([]); };

  const wipe = () => {
    ACTIVE_TABLES.forEach((t) => removeStored(ck(t), storageForTable(t)));
    removeStored(okey);
    removeStored(skey, sensitiveStorage);
    removeStored(fkey);
    removeStored(sfkey, sensitiveStorage);
    removeStored(`cm:profile:${uid}`);
  };

  const value = {
    data, save, remove, wipe, discardFailed,
    pending, failed, online, syncError, syncing, lastSync,
    syncNow: () => syncRef.current(true),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
