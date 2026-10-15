import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { createBackupEngine, hostOf, labelOf, RESTORE_TABLES, GUARDED_TABLES } from './backup';

const LAST_KEY = 'cm:last-backup';
const REMIND_DAYS = 7;
const env = import.meta.env || {};

const fmtDate = (v) => { try { return new Date(v).toLocaleString(); } catch { return String(v || ''); } };
const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const readLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } };
const writeLast = (v) => { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch { /* ignore */ } };
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const KIND = { auto: 'Automatic', manual: 'Manual', 'pre-restore': 'Before a restore' };

export default function BackupPanel({ role, online = true, pending = 0, syncNow }) {
  const engine = useMemo(() => createBackupEngine({
    client: supabase,
    identity: { church: env.VITE_CHURCH_NAME || '', memberPrefix: env.VITE_MEMBER_CODE_PREFIX || '', host: hostOf(env.VITE_SUPABASE_URL) },
  }), []);

  const [status, setStatus] = useState(null);          // server features (migration 61)
  const [snapshots, setSnapshots] = useState([]);
  const [last, setLast] = useState(readLast());
  const [busy, setBusy] = useState('');                // '', 'backup', 'snapshot', 'preview', 'restore'
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState(null);                // { bad, t }
  const [parsed, setParsed] = useState(null);          // backup chosen for restore
  const [fromSnapshot, setFromSnapshot] = useState(null);
  const [picked, setPicked] = useState({});
  const [mode, setMode] = useState('merge');
  const [preview, setPreview] = useState(null);
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [safetyFile, setSafetyFile] = useState(true);
  const [report, setReport] = useState(null);
  const fileRef = useRef(null);

  const onProgress = (p) => setProgress(p.message || (p.table ? `${labelOf(p.table)} (${p.done + 1}/${p.total})` : ''));

  async function refresh() {
    const s = await engine.serverStatus();
    setStatus(s);
    if (s.installed) { try { setSnapshots(await engine.listSnapshots()); } catch { setSnapshots([]); } }
  }
  useEffect(() => { if (online) refresh(); }, [online]);

  const ageDays = last?.at ? (Date.now() - new Date(last.at).getTime()) / 86400000 : null;
  const overdue = ageDays === null || ageDays > REMIND_DAYS;

  // ---------------------------------------------------------------- backup
  async function downloadBackup() {
    setMsg(null); setBusy('backup');
    try {
      const backup = await engine.exportBackup({ onProgress, role });
      const file = await engine.serialize(backup);
      saveBlob(file.blob, file.filename);
      const rows = Object.values(backup.tables).reduce((s, x) => s + x.count, 0);
      const l = { at: backup.exportedAt, rows, file: file.filename }; writeLast(l); setLast(l);
      setMsg({ t: `Backup saved: ${file.filename} (${rows.toLocaleString()} records, ${fmtBytes(file.blob.size)}). Keep a copy somewhere other than this device - e.g. Google Drive or email it to yourself.` });
    } catch (e) { setMsg({ bad: true, t: e.message }); } finally { setBusy(''); setProgress(''); }
  }

  async function takeSnapshot() {
    setMsg(null); setBusy('snapshot');
    try {
      const r = await engine.createSnapshot('Manual snapshot');
      setMsg({ t: `Snapshot saved on the server (${(r.total_rows || 0).toLocaleString()} records).` });
      await refresh();
    } catch (e) { setMsg({ bad: true, t: e.message }); } finally { setBusy(''); }
  }

  async function downloadSnapshot(id) {
    setMsg(null); setBusy('backup');
    try {
      const b = await engine.snapshotAsBackup(id);
      const f = await engine.serialize(b);
      saveBlob(f.blob, f.filename.replace('-backup-', '-snapshot-'));
    } catch (e) { setMsg({ bad: true, t: e.message }); } finally { setBusy(''); }
  }

  async function removeSnapshot(id) {
    if (!window.confirm('Delete this snapshot? This cannot be undone.')) return;
    try { await engine.deleteSnapshot(id); await refresh(); } catch (e) { setMsg({ bad: true, t: e.message }); }
  }

  // ---------------------------------------------------------------- choosing what to restore
  function adopt(p, snapId = null) {
    setParsed(p); setFromSnapshot(snapId); setPreview(null); setReport(null); setAck(false); setPhrase('');
    setPicked(Object.fromEntries(p.tables.map((t) => [t.table, true])));
    setMode('merge');
  }

  async function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setMsg(null); setBusy('preview'); setProgress('Reading and verifying the file...');
    try {
      const p = await engine.parseBackup(f);
      p.fileName = f.name;
      if (!p.ok) { setParsed(null); setMsg({ bad: true, t: p.errors.join(' ') }); } else adopt(p);
    } catch (err) { setMsg({ bad: true, t: err.message }); } finally { setBusy(''); setProgress(''); }
  }

  async function openSnapshot(id) {
    setMsg(null); setBusy('preview'); setProgress('Loading snapshot...');
    try {
      const b = await engine.snapshotAsBackup(id);
      const p = await engine.parseBackup(JSON.stringify(b));
      p.fileName = 'Server snapshot'; adopt(p, id);
      window.scrollTo({ top: document.getElementById('restore-panel')?.offsetTop || 0, behavior: 'smooth' });
    } catch (err) { setMsg({ bad: true, t: err.message }); } finally { setBusy(''); setProgress(''); }
  }

  const chosen = parsed ? parsed.tables.map((t) => t.table).filter((t) => picked[t]) : [];

  async function runPreview() {
    setMsg(null); setBusy('preview'); setPreview(null);
    try { setPreview(await engine.previewRestore(parsed, { tables: chosen, mode, onProgress })); }
    catch (e) { setMsg({ bad: true, t: e.message }); } finally { setBusy(''); setProgress(''); }
  }

  // ---------------------------------------------------------------- restore
  const mismatch = parsed && parsed.match !== 'same' && parsed.match !== 'unknown';
  const canRestore = parsed && chosen.length > 0 && online && pending === 0 && !busy && phrase.trim().toUpperCase() === 'RESTORE' && (!mismatch || ack) && status;

  async function runRestore() {
    setMsg(null); setReport(null); setBusy('restore');
    try {
      if (safetyFile) {
        setProgress('Saving a safety copy of the current data to this device...');
        const cur = await engine.exportBackup({ onProgress, role });
        const f = await engine.serialize(cur);
        saveBlob(f.blob, `BEFORE-RESTORE-${f.filename}`);
      }
      let res;
      if (fromSnapshot && status.installed) {
        setProgress('Saving a snapshot of the current data (so this restore can be undone)...');
        await engine.createSnapshot('Automatic snapshot before restoring a snapshot', 'pre-restore');
        setProgress('Applying the restore (all-or-nothing)...');
        res = { ...(await engine.restoreSnapshot(fromSnapshot, { mode, tables: chosen })), method: 'atomic' };
      } else {
        res = await engine.restore(parsed, { tables: chosen, mode, onProgress });
      }
      setReport({ at: new Date().toISOString(), mode, res });
      setPhrase(''); setPreview(null);
      setMsg({ t: 'Restore finished. The app is refreshing its data from the server now.' });
      if (syncNow) await syncNow();
      await refresh();
    } catch (e) { setMsg({ bad: true, t: `${e.message}${status?.installed ? ' (Nothing was changed.)' : ''}` }); }
    finally { setBusy(''); setProgress(''); }
  }

  function downloadReport() {
    saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `restore-report-${report.at.slice(0, 16).replace(/[:T]/g, '-')}.json`);
  }

  // ---------------------------------------------------------------- render
  const installed = !!status?.installed;
  return (
    <div className="panel" id="restore-panel">
      <h2>Backup &amp; Restore</h2>

      {overdue && <div className="err" style={{ marginBottom: 10, fontSize: 14 }}>
        {last ? `Your last downloaded backup was ${Math.floor(ageDays)} days ago.` : 'No backup has been downloaded from this device yet.'} Please download one now.
      </div>}
      {msg && <div className={msg.bad ? 'err' : 'muted'} style={{ marginBottom: 10, fontSize: 14 }}>{msg.t}</div>}
      {busy && progress && <div className="muted" style={{ marginBottom: 10 }}>⏳ {progress}</div>}

      <h3>1. Back up</h3>
      <p className="muted">Downloads a verified copy of <b>all church records straight from the server</b> (members, attendance, finance, children, events and more). Prayer requests and pastoral care cases are private to the Pastor, so they are not in this file (the automatic server snapshots do include them). Keep the file safe - it contains private information.{last ? ` Last backup from this device: ${fmtDate(last.at)} (${last.rows.toLocaleString()} records).` : ''}</p>
      <div className="btnrow">
        <button className="primary" onClick={downloadBackup} disabled={!!busy || !online}>{busy === 'backup' ? 'Backing up…' : 'Download full backup'}</button>
        {installed && <button className="secondary" onClick={takeSnapshot} disabled={!!busy || !online}>Save snapshot on server</button>}
      </div>
      {!online && <p className="muted">You are offline - connect to the internet to back up or restore.</p>}

      <h3 style={{ marginTop: 22 }}>2. Automatic server snapshots</h3>
      {status === null && <p className="muted">Checking…</p>}
      {status && !installed && <p className="muted">Not set up yet. Run <code>supabase/migration_61_backup_restore.sql</code> once in the Supabase SQL Editor to turn on automatic daily snapshots and the safe, all-or-nothing restore. {status.error && !status.missing ? `(${status.error})` : ''}</p>}
      {installed && <>
        <p className="muted">A snapshot of every record is saved in the database each night{status.auto_scheduled ? '' : ' (the nightly schedule is NOT active - re-run the migration)'} and before every restore. The last 14 nightly snapshots are kept. Snapshots protect against mistakes; they do not replace downloaded backups, because they live in the same database.</p>
        {snapshots.length === 0 ? <p className="muted">No snapshots yet.</p> : (
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>When</th><th>Type</th><th>Records</th><th>Size</th><th></th></tr></thead><tbody>
            {snapshots.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.created_at)}</td><td>{KIND[s.kind] || s.kind}</td><td>{(s.total_rows || 0).toLocaleString()}</td><td>{fmtBytes(s.size_bytes)}</td>
                <td><div className="btnrow">
                  <button className="secondary" disabled={!!busy} onClick={() => openSnapshot(s.id)}>Restore…</button>
                  <button className="secondary" disabled={!!busy} onClick={() => downloadSnapshot(s.id)}>Download</button>
                  {s.kind !== 'auto' && <button className="danger" disabled={!!busy} onClick={() => removeSnapshot(s.id)}>Delete</button>}
                </div></td>
              </tr>))}
          </tbody></table></div>)}
      </>}

      <h3 style={{ marginTop: 22 }}>3. Restore</h3>
      <p className="muted">Choose a backup file you downloaded earlier (or a snapshot above). Nothing changes until you review the summary and confirm.</p>
      <input ref={fileRef} type="file" accept=".json,.gz,.json.gz,application/json,application/gzip" onChange={onFile} style={{ display: 'none' }} />
      <button className="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>Choose backup file…</button>

      {parsed && <div style={{ marginTop: 16, borderTop: '1px solid #d9e2ec', paddingTop: 14 }}>
        <p><b>{parsed.fileName}</b><br />
          <span className="muted">Created {parsed.exportedAt ? fmtDate(parsed.exportedAt) : 'at an unknown time'} · {parsed.totalRows.toLocaleString()} records in {parsed.tables.length} tables · {parsed.checksumsVerified ? '✔ integrity verified' : 'integrity could not be verified'}</span></p>
        {parsed.warnings.map((w, i) => <p key={i} className="muted">⚠ {w}</p>)}
        {mismatch && <div className="err" style={{ marginBottom: 10, fontSize: 14 }}>
          {parsed.matchReasons.map((r, i) => <div key={i}>⛔ {r}</div>)}
          <label style={{ display: 'block', marginTop: 6 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand and still want to use this backup</label>
        </div>}
        {!installed && status && <p className="muted">⚠ Basic restore mode (database upgrade not installed): records are added/updated only, finance records that are locked or approved are skipped, and a failure part-way could leave a partial restore. Run migration 61 for the safe all-or-nothing restore.</p>}

        <h4>What to restore</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 4, marginBottom: 10 }}>
          {parsed.tables.map((t) => (
            <label key={t.table}><input type="checkbox" checked={!!picked[t.table]} disabled={!!busy || (!installed && GUARDED_TABLES.has(t.table))}
              onChange={(e) => { setPicked({ ...picked, [t.table]: e.target.checked }); setPreview(null); }} /> {labelOf(t.table)} <span className="muted">({t.count.toLocaleString()})</span></label>))}
        </div>
        <div className="btnrow" style={{ marginBottom: 10 }}>
          <button className="secondary" onClick={() => { setPicked(Object.fromEntries(parsed.tables.map((t) => [t.table, true]))); setPreview(null); }}>Select all</button>
          <button className="secondary" onClick={() => { setPicked({}); setPreview(null); }}>Select none</button>
        </div>

        <h4>How to restore</h4>
        <label style={{ display: 'block', marginBottom: 6 }}><input type="radio" name="rmode" checked={mode === 'merge'} onChange={() => { setMode('merge'); setPreview(null); }} disabled={!!busy} /> <b>Merge (recommended)</b> – put back anything missing and reset changed records to the backup version. Records created after the backup are kept.</label>
        <label style={{ display: 'block', marginBottom: 10, opacity: installed ? 1 : .5 }}><input type="radio" name="rmode" checked={mode === 'replace'} onChange={() => { setMode('replace'); setPreview(null); }} disabled={!!busy || !installed} /> <b>Exact copy</b> – make the selected tables match the backup exactly. <span className="err">Records created after the backup are deleted (and so is anything linked to them).</span></label>

        <button className="secondary" onClick={runPreview} disabled={!!busy || chosen.length === 0}>{busy === 'preview' && preview === null ? 'Comparing…' : 'Preview changes'}</button>
        {preview && <div style={{ overflowX: 'auto', marginTop: 10 }}><table><thead><tr><th>Table</th><th>In backup</th><th>Now</th><th>Will add</th><th>Will change</th><th>Unchanged</th><th>{mode === 'replace' ? 'Will delete' : 'Kept (newer)'}</th></tr></thead><tbody>
          {preview.map((r) => <tr key={r.table}><td>{labelOf(r.table)}</td><td>{r.inBackup}</td><td>{r.onServer}</td><td>{r.add}</td><td>{r.update}</td><td>{r.same}</td><td style={mode === 'replace' && r.remove ? { color: '#b91c1c', fontWeight: 700 } : null}>{mode === 'replace' ? r.remove : r.keepsExtra}</td></tr>)}
        </tbody></table></div>}

        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'block', marginBottom: 8 }}><input type="checkbox" checked={safetyFile} onChange={(e) => setSafetyFile(e.target.checked)} disabled={!!busy} /> Also download a safety copy of the <i>current</i> data to this device before restoring (recommended)</label>
          {pending > 0 && <p className="err">This device has {pending} unsynced change(s). Sync them first (Settings → Sync now) so they are not lost.</p>}
          <label>Type <code>RESTORE</code> to confirm</label>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="RESTORE" disabled={!!busy} style={{ width: '100%', maxWidth: 260, margin: '4px 0 10px', display: 'block' }} />
          <button className="danger" onClick={runRestore} disabled={!canRestore}>{busy === 'restore' ? 'Restoring…' : `Restore ${chosen.length} table${chosen.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>}

      {report && <div style={{ marginTop: 16, borderTop: '1px solid #d9e2ec', paddingTop: 14 }}>
        <h4>Restore report</h4>
        <p className="muted">{report.res.method === 'atomic' ? 'Applied as a single all-or-nothing operation. A snapshot of the data from just before the restore was saved - find it in the list above to undo this restore.' : 'Basic restore.'}</p>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Table</th><th>Added</th><th>Updated</th><th>Deleted</th>{report.res.method === 'basic' && <th>Failed</th>}</tr></thead><tbody>
          {Object.entries(report.res.tables || {}).map(([t, r]) => <tr key={t}><td>{labelOf(t)}</td><td>{r.inserted ?? 0}</td><td>{r.updated ?? 0}</td><td>{r.deleted ?? 0}</td>{report.res.method === 'basic' && <td>{r.failed ?? 0}</td>}</tr>)}
        </tbody></table></div>
        {report.res.skipped?.length > 0 && <p className="muted">Skipped: {report.res.skipped.map(labelOf).join(', ')}{report.res.method === 'basic' ? ' (needs the database upgrade)' : ' (table not present in this database)'}.</p>}
        {report.res.failures?.length > 0 && <p className="err">{report.res.failures.length} record(s) could not be restored - download the report for details.</p>}
        <button className="secondary" onClick={downloadReport}>Download report</button>
      </div>}
    </div>
  );
}
