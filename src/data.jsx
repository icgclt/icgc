import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export const TABLES = [
  'members', 'attendance', 'attendance_headcount', 'giving', 'departments', 'events',
  'welfare_members', 'offering_entries', 'member_contributions', 'welfare_transactions',
];

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ } };
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

// A "transient" failure means: try again later (no network, server down, token being refreshed).
// Anything else (permission denied, constraint violation) is permanent and goes to the failed list.
const isTransient = (error, status) =>
  status === 0 || status >= 500 || !error.code || String(error.code).startsWith('PGRST3');

async function send(op) {
  try {
    if (op.op === 'delete') {
      const { error, status } = await supabase.from(op.table).delete().eq('id', op.id);
      return { error, status };
    }
    const row = { ...op.row };
    SERVER_FIELDS.forEach((k) => delete row[k]);
    const { error, status } = await supabase.from(op.table).upsert(row);
    return { error, status };
  } catch (e) {
    return { error: { message: String(e?.message || e), code: '' }, status: 0 };
  }
}

export function DataProvider({ uid, children }) {
  const ck = (t) => `cm:${uid}:cache:${t}`;
  const okey = `cm:${uid}:outbox`;
  const fkey = `cm:${uid}:failed`;

  const [data, setData] = useState(() => Object.fromEntries(TABLES.map((t) => [t, read(ck(t), [])])));
  const dataRef = useRef(data);
  const outboxRef = useRef(read(okey, []));
  const failedRef = useRef(read(fkey, []));
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
    write(ck(table), rows);
    setData(dataRef.current);
  };
  const setOutbox = (o) => { outboxRef.current = o; write(okey, o); setPending(o.length); };
  const addFailed = (f) => { failedRef.current = [...failedRef.current, f]; write(fkey, failedRef.current); setFailed(failedRef.current); };

  // Push queued changes (in order), then optionally pull fresh data from the server.
  async function sync(pull = false) {
    if (!navigator.onLine) return;
    if (busy.current) { again.current = true; pullAgain.current = pullAgain.current || pull; return; }
    busy.current = true;
    setSyncing(true);
    try {
      let hadFailure = false;
      while (outboxRef.current.length) {
        const op = outboxRef.current[0];
        const { error, status } = await send(op);
        if (error && isTransient(error, status)) { setSyncError(true); break; }
        if (error) { hadFailure = true; addFailed({ ...op, error: error.message, at: new Date().toISOString() }); }
        setOutbox(outboxRef.current.slice(1));
      }
      if ((pull || hadFailure) && outboxRef.current.length === 0) {
        const next = {};
        for (const t of TABLES) next[t] = await fetchAll(t);
        // only replace local data if nothing new was queued while we were fetching
        if (outboxRef.current.length === 0) {
          dataRef.current = next;
          TABLES.forEach((t) => write(ck(t), next[t]));
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
    const iv = setInterval(() => { if (!document.hidden) syncRef.current(true); }, 60000);
    syncRef.current(true);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('visibilitychange', vis);
      clearInterval(iv);
    };
  }, []);

  // Optimistic writes: update the screen + local cache immediately, queue the change, sync in the background.
  const save = (table, row) => {
    const list = dataRef.current[table];
    const i = list.findIndex((x) => x.id === row.id);
    commit(
      table,
      i >= 0
        ? list.map((x) => (x.id === row.id ? { ...x, ...row } : x))
        : [...list, { created_at: new Date().toISOString(), ...row }],
    );
    setOutbox([...outboxRef.current, { op: 'upsert', table, row }]);
    syncRef.current(false);
  };

  const remove = (table, id) => {
    commit(table, dataRef.current[table].filter((x) => x.id !== id));
    setOutbox([...outboxRef.current, { op: 'delete', table, id }]);
    syncRef.current(false);
  };

  const discardFailed = () => { failedRef.current = []; write(fkey, []); setFailed([]); };

  const wipe = () => {
    TABLES.forEach((t) => localStorage.removeItem(ck(t)));
    localStorage.removeItem(okey);
    localStorage.removeItem(fkey);
    localStorage.removeItem(`cm:profile:${uid}`);
  };

  const value = {
    data, save, remove, wipe, discardFailed,
    pending, failed, online, syncError, syncing, lastSync,
    syncNow: () => syncRef.current(true),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
