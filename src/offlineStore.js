// Offline copy of the church data, kept in IndexedDB.
// Local storage holds only a few MB, which the attendance table outgrows after a while; IndexedDB holds
// hundreds of MB. If IndexedDB is unavailable (some private-browsing modes) everything falls back to
// local storage, exactly as before.

const DB_NAME = 'cm-offline';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

// Runs one transaction. Resolves { ok, value }; never throws.
async function run(mode, fn) {
  const db = await openDb();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve({ ok: true, value: request?.result });
      tx.onerror = () => resolve({ ok: false });
      tx.onabort = () => resolve({ ok: false });
    } catch { resolve({ ok: false }); }
  });
}

export const idbGet = (key) => run('readonly', (s) => s.get(key));
export const idbSet = async (key, value) => (await run('readwrite', (s) => s.put(value, key))).ok;
export const idbDelete = async (key) => (await run('readwrite', (s) => s.delete(key))).ok;

const readLocal = (k, storage) => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const dropLocal = (k, storage) => { try { storage.removeItem(k); } catch { /* ignore */ } };

// Saves one table. Resolves true only if the copy was really stored somewhere.
export async function persistCache(key, rows) {
  if (await idbSet(key, rows)) { dropLocal(key, localStorage); return true; }
  return writeLocal(key, rows); // IndexedDB unavailable or full: use local storage as before
}

export async function deleteCache(key) {
  await idbDelete(key);
  dropLocal(key, localStorage);
  try { if (typeof sessionStorage !== 'undefined') dropLocal(key, sessionStorage); } catch { /* ignore */ }
}

// Loads every table for the signed-in user. Copies saved by older versions (local storage, or
// session storage for the money tables) are moved into IndexedDB the first time.
export async function loadTableCaches(keyFor, tables, sensitive = new Set()) {
  const out = {};
  for (const t of tables) {
    const key = keyFor(t);
    const got = await idbGet(key);
    if (got.ok && Array.isArray(got.value)) {
      out[t] = got.value;
      dropLocal(key, localStorage); // free the space an older copy was using
      continue;
    }
    let legacy = readLocal(key, localStorage);
    if (legacy === null && sensitive.has(t) && typeof sessionStorage !== 'undefined') legacy = readLocal(key, sessionStorage);
    out[t] = Array.isArray(legacy) ? legacy : [];
    if (legacy !== null && got.ok && (await idbSet(key, out[t]))) {
      dropLocal(key, localStorage);
      try { if (typeof sessionStorage !== 'undefined') dropLocal(key, sessionStorage); } catch { /* ignore */ }
    }
  }
  return out;
}
