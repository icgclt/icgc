// Backup & restore engine shared by ICGC Testimony Temple (TT) and ICGC Dominion Temple (DT).
// No imports on purpose: the Supabase client is injected, so the engine can be unit-tested.
//
// File format (v2): { format, version, exportedAt, source, identity, tables:{name:{count,sha256}},
//                     warnings, data:{ table:[rows] } }  - optionally gzip-compressed (.json.gz).
// Legacy files from the old "Download JSON backup" button ({ exportedAt, data }) can still be restored.

export const BACKUP_FORMAT = 'icgc-church-backup';
export const BACKUP_VERSION = 2;

// Parents first. MUST match public.backup_table_list() in supabase/migration_61_backup_restore.sql.
export const RESTORE_TABLES = [
  'branches', 'families', 'members', 'children', 'departments', 'groups', 'events', 'volunteers',
  'welfare_members', 'finance_weekly_reports', 'finance_weekday_collections',
  'notification_campaigns', 'communication_templates',
  'attendance', 'attendance_headcount', 'giving', 'offering_entries', 'member_contributions',
  'welfare_transactions', 'expenditures', 'cashbook_entries', 'visitors', 'follow_ups', 'prayer_requests',
  'service_plans', 'pastoral_cases', 'event_registrations', 'announcements', 'child_checkins',
  'department_members', 'group_members', 'group_attendance', 'pledges', 'payment_receipts',
  'communication_queue', 'finance_reconciliations', 'notification_logs', 'payment_requests',
  'payment_webhook_events', 'member_notification_preferences', 'member_group_history',
  'member_status_history', 'abc_class_attendance', 'finance_weekly_cash_counts', 'finance_weekly_momo',
  'finance_weekday_cash_counts', 'finance_weekday_momo', 'volunteer_schedules', 'finance_workflow_audit',
];

// Tables protected by finance lock/workflow triggers. Only the database restore function can bring these
// back faithfully; the plain fallback restore skips them.
export const GUARDED_TABLES = new Set([
  'expenditures', 'finance_weekly_reports', 'finance_weekly_cash_counts', 'finance_weekly_momo',
  'finance_weekday_collections', 'finance_weekday_cash_counts', 'finance_weekday_momo',
]);

const LABELS = {
  members: 'Members', attendance: 'Attendance', attendance_headcount: 'Attendance headcount', giving: 'Giving',
  departments: 'Departments', events: 'Events', welfare_members: 'Welfare members', offering_entries: 'Offering entries',
  member_contributions: 'Member contributions', welfare_transactions: 'Welfare transactions', expenditures: 'Expenditure',
  cashbook_entries: 'Cashbook', visitors: 'Visitors', groups: 'Groups', follow_ups: 'Follow-ups',
  prayer_requests: 'Prayer requests', service_plans: 'Service plans', pastoral_cases: 'Pastoral care',
  families: 'Families', children: 'Children', child_checkins: 'Children check-ins', branches: 'Branches',
  finance_weekly_reports: 'Weekly finance reports', finance_weekday_collections: 'Weekday collections',
};
export const labelOf = (t) => LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' '));

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const isMissingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''));
const isMissingFunction = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|function .* does not exist/i.test(e.message || ''));
const isTransient = (e) => !!e && (e.status === 0 || e.status >= 500 || !e.code || e.code === '' || String(e.code).startsWith('PGRST3') || /fetch|network|timeout|failed to/i.test(e.message || ''));

export function hostOf(url) { try { return new URL(url).host; } catch { return ''; } }

export async function sha256Hex(text) {
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return ''; // checksums unavailable (e.g. page not served over HTTPS); the file is still usable
}

export function chunkRows(rows, maxRows = 1000, maxBytes = 1500000) {
  const out = []; let cur = []; let bytes = 0;
  for (const r of rows) {
    const b = JSON.stringify(r).length;
    if (cur.length && (cur.length >= maxRows || bytes + b > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += b;
  }
  if (cur.length || !out.length) out.push(cur);
  return out;
}

const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
};
const IGNORE_WHEN_COMPARING = new Set(['updated_at']);
const sameRow = (backupRow, serverRow) => Object.keys(backupRow).every((k) => IGNORE_WHEN_COMPARING.has(k) || stable(backupRow[k]) === stable(serverRow?.[k]));

export async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// Reads a File/Blob/ArrayBuffer/string (plain JSON or gzip) and returns the JSON text.
export async function readBackupText(input) {
  if (typeof input === 'string') return input;
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed backups. Use a current Chrome, Edge, Firefox or Safari.');
    return gunzipBytes(bytes);
  }
  return new TextDecoder().decode(bytes);
}

const guessPrefix = (members) => {
  const counts = {};
  for (const m of members || []) {
    const hit = /^([A-Z]{1,6}?)[AOC]\d+$/.exec(String(m?.member_code || '').trim().toUpperCase());
    if (hit) counts[hit[1]] = (counts[hit[1]] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

export function createBackupEngine({ client, identity = {}, sleep = sleepDefault, pageSize = 1000 }) {
  const me = { church: identity.church || '', memberPrefix: String(identity.memberPrefix || '').toUpperCase(), host: identity.host || '' };

  async function retry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!isTransient(e) || i === tries - 1) throw e;
        await sleep(400 * 2 ** i);
      }
    }
    throw last;
  }

  // ------------------------------------------------------------------ reading the live database
  async function fetchTable(table) {
    const rows = [];
    let ordered = true;
    for (let from = 0; ; from += pageSize) {
      const page = await retry(async () => {
        let q = client.from(table).select('*');
        if (ordered) q = q.order('id');
        const { data, error, status } = await q.range(from, from + pageSize - 1);
        if (error) { if (ordered && error.code === '42703') { ordered = false; return null; } throw Object.assign(new Error(error.message), { code: error.code, status }); }
        return data;
      });
      if (page === null) { from -= pageSize; continue; }
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  async function countTable(table) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
    if (error) return null;
    return count;
  }

  // Reads every table straight from the server (never from the device's offline copy) and checks that the
  // number of rows received matches the server's own count, retrying if records changed mid-download.
  async function exportBackup({ onProgress = () => {}, tables = RESTORE_TABLES, role = '' } = {}) {
    const data = {}; const meta = {}; const missing = []; const warnings = [];
    let done = 0;
    for (const t of tables) {
      onProgress({ phase: 'export', table: t, done, total: tables.length });
      let rows;
      try {
        for (let attempt = 0; ; attempt++) {
          rows = await fetchTable(t);
          const n = await countTable(t);
          if (n === null || n === rows.length) break;
          if (attempt >= 2) { warnings.push(`${t}: records changed while downloading (${rows.length} read, ${n} on server).`); break; }
          await sleep(300);
        }
      } catch (e) {
        if (isMissingTable(e)) { missing.push(t); done++; continue; }
        throw new Error(`Backup incomplete - could not read "${t}": ${e.message}. Nothing was saved; please try again.`);
      }
      data[t] = rows;
      meta[t] = { count: rows.length, sha256: await sha256Hex(JSON.stringify(rows)) };
      done++;
    }
    onProgress({ phase: 'export', done, total: tables.length });
    return buildBackup(data, { meta, missing, warnings, source: 'live-database', role });
  }

  async function buildBackup(data, { meta, missing = [], warnings = [], source = 'live-database', role = '' } = {}) {
    const tablesMeta = meta || {};
    if (!meta) for (const [t, rows] of Object.entries(data)) tablesMeta[t] = { count: rows.length, sha256: await sha256Hex(JSON.stringify(rows)) };
    return {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), source,
      identity: { ...me }, exportedByRole: role || undefined,
      tables: tablesMeta, missingTables: missing, warnings, data,
    };
  }

  // Turns a backup object into a downloadable Blob (compressed when the browser supports it).
  async function serialize(backup, { compress = true } = {}) {
    const text = JSON.stringify(backup);
    const stamp = backup.exportedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const slug = (me.memberPrefix || me.church || 'church').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (compress && typeof CompressionStream !== 'undefined') {
      return { blob: await gzipText(text), filename: `icgc-${slug}-backup-${stamp}.json.gz`, compressed: true };
    }
    return { blob: new Blob([text], { type: 'application/json' }), filename: `icgc-${slug}-backup-${stamp}.json`, compressed: false };
  }

  // ------------------------------------------------------------------ reading a backup file
  async function parseBackup(input) {
    const errors = []; const warnings = [];
    let raw;
    try { raw = JSON.parse(await readBackupText(input)); } catch (e) {
      return { ok: false, errors: [`This file could not be read as a backup (${e.message}).`], warnings };
    }
    if (!raw || typeof raw !== 'object' || !raw.data || typeof raw.data !== 'object') {
      return { ok: false, errors: ['This is not a church backup file (no data section found).'], warnings };
    }
    const legacy = raw.format !== BACKUP_FORMAT;
    if (!legacy && raw.version > BACKUP_VERSION) warnings.push('This backup was made by a newer version of the app. Unknown parts will be ignored.');
    const data = {}; const info = []; let checksumsVerified = !legacy; let checksumFailed = false;
    const unknown = Object.keys(raw.data).filter((t) => !RESTORE_TABLES.includes(t));
    for (const t of RESTORE_TABLES) {
      if (!(t in raw.data)) continue;
      const rows = raw.data[t];
      if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
        errors.push(`Table "${t}" is damaged in this file.`); continue;
      }
      data[t] = rows;
      let checksumOk = null;
      const expected = raw.tables?.[t];
      if (expected) {
        if (expected.count !== rows.length) { checksumOk = false; }
        else if (expected.sha256) {
          const actual = await sha256Hex(JSON.stringify(rows));
          checksumOk = actual ? actual === expected.sha256 : null;
          if (checksumOk === null) checksumsVerified = false;
        }
        if (checksumOk === false) checksumFailed = true;
      }
      info.push({ table: t, count: rows.length, checksumOk });
    }
    if (checksumFailed) errors.push('Integrity check FAILED: this file was changed or damaged after it was created. Do not restore from it.');
    if (!info.length) errors.push('This backup contains no restorable tables.');
    if (unknown.length) warnings.push(`Ignored data that this app does not restore: ${unknown.join(', ')}.`);
    if (legacy) warnings.push('This is an older-style backup without integrity checksums, so it cannot be verified.');
    else if (!checksumsVerified && !checksumFailed) warnings.push('Integrity checksums could not be verified in this browser (needs a secure https page).');
    if (raw.missingTables?.length) warnings.push(`Tables that did not exist when this backup was made: ${raw.missingTables.join(', ')}.`);

    const backupIdentity = legacy ? { memberPrefix: guessPrefix(data.members), church: '', host: '', inferred: true } : (raw.identity || {});
    const reasons = []; let match = 'unknown';
    if (backupIdentity.memberPrefix && me.memberPrefix) {
      if (backupIdentity.memberPrefix.toUpperCase() !== me.memberPrefix) { match = 'different'; reasons.push(`This backup looks like it belongs to a different church (member IDs start with "${backupIdentity.memberPrefix}", this app uses "${me.memberPrefix}").`); }
      else match = 'same';
    }
    if (backupIdentity.host && me.host && backupIdentity.host !== me.host) {
      if (match !== 'different') match = 'different-project';
      reasons.push('This backup was taken from a different Supabase project than the one this app is connected to.');
    }
    return {
      ok: errors.length === 0, errors, warnings, legacy, checksumsVerified: checksumsVerified && !checksumFailed,
      exportedAt: raw.exportedAt || null, source: raw.source || (legacy ? 'legacy-download' : ''),
      identity: backupIdentity, match, matchReasons: reasons, tables: info, data,
      totalRows: info.reduce((s, x) => s + x.count, 0),
    };
  }

  // ------------------------------------------------------------------ server features (migration 61)
  async function serverStatus() {
    const { data, error } = await client.rpc('backup_status');
    if (error) return { installed: false, missing: isMissingFunction(error), error: error.message };
    return data;
  }

  async function listSnapshots() {
    const { data, error } = await client.from('backup_snapshots')
      .select('id,created_at,kind,note,row_counts,total_rows,size_bytes')
      .order('created_at', { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function createSnapshot(note, kind = 'manual') {
    const { data, error } = await client.rpc('create_backup_snapshot', { p_note: note || null, p_kind: kind });
    if (error) throw new Error(error.message);
    return data;
  }

  async function deleteSnapshot(id) {
    const { error } = await client.rpc('delete_backup_snapshot', { p_id: id });
    if (error) throw new Error(error.message);
  }

  async function snapshotAsBackup(id) {
    const { data, error } = await client.from('backup_snapshots').select('created_at,kind,note,data').eq('id', id).single();
    if (error) throw new Error(error.message);
    const b = await buildBackup(data.data, { source: `server-snapshot (${data.kind}, ${data.created_at})` });
    b.exportedAt = data.created_at;
    return b;
  }

  async function restoreSnapshot(id, { mode = 'merge', tables = null } = {}) {
    const { data, error } = await client.rpc('restore_from_snapshot', { p_snapshot: id, p_mode: mode, p_tables: tables });
    if (error) throw new Error(error.message);
    return data;
  }

  // ------------------------------------------------------------------ preview (changes nothing)
  async function previewRestore(parsed, { tables, mode = 'merge', onProgress = () => {} }) {
    const out = []; let done = 0;
    for (const t of RESTORE_TABLES.filter((x) => tables.includes(x) && x in parsed.data)) {
      onProgress({ phase: 'preview', table: t, done, total: tables.length });
      const mine = parsed.data[t];
      let live = [];
      let exists = true;
      try { live = await fetchTable(t); } catch (e) { if (isMissingTable(e)) exists = false; else throw e; }
      const byId = new Map(live.map((r) => [r.id, r]));
      let add = 0; let update = 0; let same = 0;
      const ids = new Set();
      for (const r of mine) {
        ids.add(r.id);
        const cur = byId.get(r.id);
        if (!cur) add++; else if (sameRow(r, cur)) same++; else update++;
      }
      const remove = mode === 'replace' ? live.filter((r) => !ids.has(r.id)).length : 0;
      out.push({ table: t, exists, inBackup: mine.length, onServer: live.length, add, update, same, remove, keepsExtra: mode === 'merge' ? live.filter((r) => !ids.has(r.id)).length : 0 });
      done++;
    }
    return out;
  }

  // ------------------------------------------------------------------ restore
  // Preferred path: stage the file on the server in small pieces, then ONE database call applies it all
  // inside a single transaction (all-or-nothing). A pre-restore snapshot is taken first.
  async function restoreAtomic(parsed, { tables, mode = 'merge', onProgress = () => {} }) {
    const chosen = RESTORE_TABLES.filter((t) => tables.includes(t) && t in parsed.data);
    onProgress({ phase: 'snapshot', message: 'Saving a snapshot of the current data (so this restore can be undone)...' });
    const snap = await createSnapshot(`Automatic snapshot before restoring a backup (${mode})`, 'pre-restore');
    const session = globalThis.crypto.randomUUID();
    try {
      let step = 0;
      for (const t of chosen) {
        const pieces = chunkRows(parsed.data[t]);
        for (let i = 0; i < pieces.length; i++) {
          onProgress({ phase: 'upload', table: t, done: step, total: chosen.length, message: `Uploading ${labelOf(t)}...` });
          await retry(async () => {
            const { error } = await client.rpc('backup_restore_stage', { p_session: session, p_table: t, p_seq: i, p_rows: pieces[i] });
            if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.status });
          });
        }
        step++;
      }
      onProgress({ phase: 'apply', done: chosen.length, total: chosen.length, message: 'Applying the restore (all-or-nothing)...' });
      const { data, error } = await client.rpc('backup_restore_apply', { p_session: session, p_mode: mode, p_tables: chosen });
      if (error) throw new Error(error.message);
      return { ...data, snapshot: snap, method: 'atomic' };
    } catch (e) {
      try { await client.rpc('backup_restore_abort', { p_session: session }); } catch { /* best effort */ }
      throw e;
    }
  }

  // Fallback when migration 61 is not installed: ordinary upserts through the normal API. Merge only,
  // finance-locked tables are skipped, and a failure part-way can leave a partial restore.
  async function restoreBasic(parsed, { tables, onProgress = () => {} }) {
    const chosen = RESTORE_TABLES.filter((t) => tables.includes(t) && t in parsed.data);
    const result = {}; const skipped = []; const failures = [];
    const sameProject = !parsed.identity?.host || !me.host || parsed.identity.host === me.host;
    let step = 0;
    for (const t of chosen) {
      onProgress({ phase: 'restore', table: t, done: step++, total: chosen.length, message: `Restoring ${labelOf(t)}...` });
      if (GUARDED_TABLES.has(t)) { skipped.push(t); continue; }
      let inserted = 0; let failed = 0;
      const clean = (r) => { const x = { ...r }; delete x.updated_at; if (!sameProject) { x.created_by = null; x.user_id = null; } return x; };
      for (const piece of chunkRows(parsed.data[t], 200)) {
        const rows = piece.map(clean);
        const { error } = await retry(async () => client.from(t).upsert(rows, { onConflict: 'id' }));
        if (!error) { inserted += rows.length; continue; }
        for (const r of rows) { // isolate the bad rows
          let { error: e1 } = await client.from(t).upsert(r, { onConflict: 'id' });
          if (e1 && e1.code === '23503') { ({ error: e1 } = await client.from(t).upsert({ ...r, created_by: null, user_id: null }, { onConflict: 'id' })); }
          if (e1) { failed++; if (failures.length < 50) failures.push({ table: t, id: r.id, error: e1.message }); } else inserted++;
        }
      }
      result[t] = { inserted, updated: 0, deleted: 0, in_backup: parsed.data[t].length, failed };
    }
    return { tables: result, skipped, failures, method: 'basic', mode: 'merge' };
  }

  async function restore(parsed, opts) {
    const status = await serverStatus();
    if (status.installed) return restoreAtomic(parsed, opts);
    if (opts.mode === 'replace') throw new Error('Exact-copy restore needs the database upgrade (migration_61_backup_restore.sql). Run it in the Supabase SQL Editor first.');
    return restoreBasic(parsed, opts);
  }

  return {
    me, fetchTable, exportBackup, buildBackup, serialize, parseBackup, serverStatus, listSnapshots, createSnapshot,
    deleteSnapshot, snapshotAsBackup, restoreSnapshot, previewRestore, restore, restoreAtomic, restoreBasic,
  };
}
