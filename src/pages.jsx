import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, can, ROLES } from './auth';
import { useData, TABLES } from './data';
import { supabase } from './supabase';
import Crud from './Crud';
import { money, today, downloadCSV, download, parseCSV, uuid } from './utils';

const STATUS = ['Active', 'Inactive', 'Visitor'];
const SERVICES = ['Sunday Service', 'Midweek Service', 'Prayer Meeting', 'Other'];
const badge = (v) => <span className="badge">{v}</span>;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- Dashboard ---------------- */
export function Dashboard() {
  const { data } = useData();
  const { role, profile } = useAuth();
  const showGiving = can(role, 'giving', 'read');
  const month = today().slice(0, 7);
  const monthGiving = data.giving.filter((g) => String(g.date).startsWith(month)).reduce((a, g) => a + Number(g.amount), 0);
  const active = data.members.filter((m) => m.status === 'Active').length;
  const lastDate = data.attendance.map((a) => a.date).sort().pop();
  const lastPresent = data.attendance.filter((a) => a.date === lastDate && a.status === 'Present').length;
  const upcoming = data.events.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const recent = [...data.members].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);

  return (
    <>
      <div className="top">
        <div>
          <h1>Dashboard</h1>
          <div className="muted">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}</div>
        </div>
      </div>
      <div className="cards">
        <div className="card"><div className="label">Active members</div><div className="num">{active}</div><div className="muted sm">{data.members.length} total</div></div>
        <div className="card"><div className="label">Last attendance{lastDate ? ` (${lastDate})` : ''}</div><div className="num">{lastPresent}</div><div className="muted sm">present</div></div>
        {showGiving && <div className="card"><div className="label">Giving this month</div><div className="num" style={{ fontSize: 22 }}>{money(monthGiving)}</div></div>}
        <div className="card"><div className="label">Departments</div><div className="num">{data.departments.length}</div></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>Recent members</h2>
          {recent.length ? recent.map((m) => (
            <p key={m.id}><b>{m.name}</b><br /><span className="muted">{m.phone || 'No phone'} · {m.status}</span></p>
          )) : <div className="empty">No members yet.</div>}
        </div>
        <div className="panel">
          <h2>Upcoming events</h2>
          {upcoming.length ? upcoming.map((e) => (
            <p key={e.id}><b>{e.title}</b><br /><span className="muted">{e.date}{e.location ? ` · ${e.location}` : ''}</span></p>
          )) : <div className="empty">No upcoming events.</div>}
        </div>
      </div>
    </>
  );
}

/* ---------------- Modules (all use the generic Crud component) ---------------- */
const MEMBER_CSV_FIELDS = ['name', 'phone', 'email', 'dob', 'gender', 'grp', 'status', 'address', 'notes'];

function MemberImport() {
  const { data, save } = useData();
  const { role } = useAuth();
  const fileRef = useRef(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!can(role, 'members', 'write')) return null;

  const downloadTemplate = () =>
    download('members-template.csv', '\ufeff' + MEMBER_CSV_FIELDS.join(',') + '\r\n' + 'Jane Doe,0244000000,,,Female,Youth,Active,,\r\n', 'text/csv;charset=utf-8');

  const importCSV = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const rows = parseCSV(await file.text());
      if (!rows.length) { setMsg({ ok: false, text: 'No rows found in that file — check it has a header row plus at least one member.' }); return; }
      const byName = new Map(data.members.map((m) => [m.name.trim().toLowerCase(), m]));
      let added = 0, updated = 0, skipped = 0;
      for (const r of rows) {
        const name = (r.name || '').trim();
        if (!name) { skipped++; continue; }
        const match = byName.get(name.toLowerCase());
        const status = r.status || match?.status || 'Active';
        save('members', {
          id: match ? match.id : uuid(),
          name,
          phone: r.phone || match?.phone || '',
          email: r.email || match?.email || '',
          dob: r.dob || match?.dob || null,
          gender: r.gender || match?.gender || null,
          grp: r.grp || r.group || match?.grp || '',
          status: STATUS.includes(status) ? status : 'Active',
          address: r.address || match?.address || '',
          notes: r.notes || match?.notes || '',
        });
        match ? updated++ : added++;
      }
      setMsg({ ok: true, text: `Done — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (missing name)` : ''}.` });
    } catch (err) {
      setMsg({ ok: false, text: 'Could not read that file. Make sure it is a plain CSV export.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="top" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Bulk upload / download</h2>
        <div className="btnrow">
          <button className="secondary" onClick={downloadTemplate}>Download CSV template</button>
          <button className="secondary" onClick={() => data.members.length ? downloadCSV('members', data.members) : alert('No members to export yet.')}>Download all members (CSV)</button>
          <button className="primary" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? 'Importing…' : 'Upload CSV'}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={importCSV} />
        </div>
      </div>
      <p className="muted sm">
        CSV columns: <code>{MEMBER_CSV_FIELDS.join(', ')}</code>. Matching by name — a row whose name already
        exists updates that member instead of creating a duplicate.
      </p>
      {msg && <div className={msg.ok ? 'muted' : 'err'} style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}

export function Members() {
  return (
    <>
      <MemberImport />
      <Crud
      table="members" title="Members" noun="member"
      sortKey="name" searchKeys={['name', 'phone', 'grp', 'email']}
      filters={[{ key: 'status', label: 'All statuses', options: STATUS }]}
      defaults={{ status: 'Active' }}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'dob', label: 'Date of birth', type: 'date' },
        { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female'] },
        { key: 'grp', label: 'Group / Cell' },
        { key: 'status', label: 'Status', type: 'select', options: STATUS, required: true },
        { key: 'address', label: 'Address' },
        { key: 'notes', label: 'Notes', type: 'textarea', full: true },
      ]}
      columns={[
        { label: 'Name', render: (m) => <><b>{m.name}</b><br /><small>{m.email}</small></> },
        { label: 'Phone', key: 'phone' },
        { label: 'Group', key: 'grp' },
        { label: 'Status', render: (m) => badge(m.status) },
      ]}
      />
    </>
  );
}

export function Attendance() {
  const { data } = useData();
  return (
    <Crud
      table="attendance" title="Attendance" noun="attendance"
      sortKey="date" sortDir="desc" searchKeys={['person_name', 'note']}
      filters={[
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'service', label: 'All services', options: SERVICES },
      ]}
      defaults={{ date: today(), service: 'Sunday Service', status: 'Present' }}
      suggest={{ person_name: data.members.map((m) => m.name) }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'service', label: 'Service', type: 'select', options: SERVICES, required: true },
        { key: 'person_name', label: 'Person / member name', required: true, full: true },
        { key: 'status', label: 'Status', type: 'select', options: ['Present', 'Absent', 'Visitor'], required: true },
        { key: 'note', label: 'Note' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Service', key: 'service' },
        { label: 'Person', key: 'person_name' },
        { label: 'Status', render: (r) => badge(r.status) },
        { label: 'Note', key: 'note' },
      ]}
    />
  );
}

// Tap-to-cycle attendance sheet: one screen, one tap per member, no per-person forms.
// Cycle per tap: unmarked -> Present -> Absent -> unmarked. Loads existing marks for the
// chosen date+service so re-opening a sheet lets you correct it rather than duplicate it.
export function QuickAttendance() {
  const { data, save } = useData();
  const [date, setDate] = useState(today());
  const [service, setService] = useState('Sunday Service');
  const [q, setQ] = useState('');
  const [marks, setMarks] = useState({});

  const members = useMemo(
    () => [...data.members].filter((m) => m.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)),
    [data.members],
  );

  const existing = useMemo(() => {
    const map = new Map();
    data.attendance.forEach((a) => { if (a.date === date && a.service === service) map.set(a.person_name, a); });
    return map;
  }, [data.attendance, date, service]);

  useEffect(() => {
    const next = {};
    members.forEach((m) => { const ex = existing.get(m.name); if (ex) next[m.id] = ex.status; });
    setMarks(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, service]);

  const shown = members.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));

  const toggle = (id) => setMarks((prev) => {
    const cur = prev[id];
    const next = { ...prev };
    if (cur === 'Present') next[id] = 'Absent';
    else if (cur === 'Absent') delete next[id];
    else next[id] = 'Present';
    return next;
  });

  const markAllShown = (status) => setMarks((prev) => {
    const next = { ...prev };
    shown.forEach((m) => { next[m.id] = status; });
    return next;
  });

  const saveAll = () => {
    let n = 0;
    members.forEach((m) => {
      const status = marks[m.id];
      if (!status) return;
      const ex = existing.get(m.name);
      save('attendance', { id: ex ? ex.id : uuid(), date, service, person_name: m.name, status, note: ex?.note || '' });
      n++;
    });
    alert(n ? `Saved attendance for ${n} member(s).` : 'Nothing marked yet — tap names to mark them first.');
  };

  const presentCount = members.filter((m) => marks[m.id] === 'Present').length;
  const absentCount = members.filter((m) => marks[m.id] === 'Absent').length;

  return (
    <>
      <div className="top">
        <h1>Quick Attendance</h1>
        <button className="primary" onClick={saveAll}>Save attendance</button>
      </div>
      <div className="panel">
        <div className="toolbar">
          <div className="fld"><small>Date</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="fld"><small>Service</small>
            <select value={service} onChange={(e) => setService(e.target.value)}>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <input placeholder="Search member…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="btnrow" style={{ marginBottom: 12 }}>
          <button className="secondary sm" onClick={() => markAllShown('Present')}>Mark all shown Present</button>
          <button className="secondary sm" onClick={() => markAllShown('Absent')}>Mark all shown Absent</button>
        </div>
        <p className="muted sm">{presentCount} present · {absentCount} absent · {members.length - presentCount - absentCount} unmarked. Tap a name to cycle: unmarked → Present → Absent → unmarked.</p>
        <div className="quicklist">
          {shown.map((m) => {
            const status = marks[m.id];
            return (
              <button key={m.id} type="button" className={'quickrow' + (status ? ' ' + status.toLowerCase() : '')} onClick={() => toggle(m.id)}>
                <span>{m.name}</span>
                <span className="badge">{status || 'Unmarked'}</span>
              </button>
            );
          })}
          {!shown.length && <div className="empty">No members match.</div>}
        </div>
      </div>
    </>
  );
}

export function Giving() {
  return (
    <Crud
      table="giving" title="Giving" noun="transaction"
      sortKey="date" sortDir="desc" searchKeys={['giver', 'reference']}
      filters={[
        { key: 'type', label: 'All types', options: ['Tithe', 'Offering', 'Donation', 'Pledge', 'Other'] },
        { key: 'method', label: 'All methods', options: ['Cash', 'Mobile Money', 'Bank', 'Card'] },
      ]}
      defaults={{ date: today(), type: 'Tithe', method: 'Cash' }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'giver', label: 'Giver', fallback: 'Anonymous' },
        { key: 'type', label: 'Type', type: 'select', options: ['Tithe', 'Offering', 'Donation', 'Pledge', 'Other'], required: true },
        { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: 0, required: true },
        { key: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Mobile Money', 'Bank', 'Card'], required: true },
        { key: 'reference', label: 'Reference' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Giver', key: 'giver' },
        { label: 'Type', key: 'type' },
        { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
        { label: 'Method', key: 'method' },
        { label: 'Reference', key: 'reference' },
      ]}
    />
  );
}

export function Departments() {
  return (
    <Crud
      table="departments" title="Departments" noun="department"
      sortKey="name" searchKeys={['name', 'leader']}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'leader', label: 'Leader' },
        { key: 'notes', label: 'Members / notes', type: 'textarea', full: true },
      ]}
      columns={[
        { label: 'Department', render: (d) => <b>{d.name}</b> },
        { label: 'Leader', key: 'leader' },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  );
}

export function Events() {
  return (
    <Crud
      table="events" title="Events" noun="event"
      sortKey="date" searchKeys={['title', 'location']}
      defaults={{ date: today() }}
      fields={[
        { key: 'title', label: 'Event title', required: true },
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'event_time', label: 'Time' },
        { key: 'location', label: 'Location' },
        { key: 'description', label: 'Description', type: 'textarea', full: true },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Event', render: (e) => <><b>{e.title}</b><br /><small>{e.description}</small></> },
        { label: 'Location', key: 'location' },
        { label: 'Time', key: 'event_time' },
      ]}
    />
  );
}

/* ---------------- SMS ---------------- */
export function SendSMS() {
  const { data } = useData();
  const { role } = useAuth();
  const allowed = ['admin', 'secretary'].includes(role);
  const groups = [...new Set(data.members.map((m) => m.grp).filter(Boolean))].sort();

  const [audience, setAudience] = useState('active');
  const [group, setGroup] = useState(groups[0] || '');
  const [picked, setPicked] = useState({});
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  if (!allowed) return (
    <>
      <div className="top"><h1>Send SMS</h1></div>
      <div className="panel"><p className="muted">Only admins and secretaries can send SMS.</p></div>
    </>
  );

  const withPhone = data.members.filter((m) => m.phone && String(m.phone).trim());
  let recipients = [];
  if (audience === 'active') recipients = withPhone.filter((m) => m.status === 'Active');
  else if (audience === 'all') recipients = withPhone;
  else if (audience === 'group') recipients = withPhone.filter((m) => m.grp === group);
  else recipients = withPhone.filter((m) => picked[m.id]);

  const shownForPick = withPhone.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const segments = Math.ceil((message.length || 0) / 160) || 0;

  const send = async () => {
    if (!recipients.length) { setResult({ ok: false, text: 'No recipients selected.' }); return; }
    if (!message.trim()) { setResult({ ok: false, text: 'Write a message first.' }); return; }
    if (!confirm(`Send this message to ${recipients.length} member(s)?`)) return;
    setSending(true);
    setResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('send-sms', {
        body: { recipients: recipients.map((m) => m.phone), message },
      });
      if (error) throw error;
      if (res?.error) setResult({ ok: false, text: res.error });
      else setResult({ ok: true, text: `Sent to ${res.sent} member(s).` });
    } catch (err) {
      setResult({ ok: false, text: err?.message || 'Could not reach the SMS service.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="top"><h1>Send SMS</h1></div>
      <div className="panel">
        <h2>Recipients</h2>
        <div className="toolbar">
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="active">All active members</option>
            <option value="all">All members with a phone number</option>
            <option value="group">By group</option>
            <option value="custom">Choose individually</option>
          </select>
          {audience === 'group' && (
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {groups.length ? groups.map((g) => <option key={g}>{g}</option>) : <option value="">No groups yet</option>}
            </select>
          )}
        </div>
        {audience === 'custom' && (
          <>
            <input placeholder="Search member…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
            <div className="quicklist">
              {shownForPick.map((m) => (
                <button key={m.id} type="button" className={'quickrow' + (picked[m.id] ? ' present' : '')}
                  onClick={() => setPicked((p) => ({ ...p, [m.id]: !p[m.id] }))}>
                  <span>{m.name}</span><span className="badge">{picked[m.id] ? 'Selected' : m.phone}</span>
                </button>
              ))}
              {!shownForPick.length && <div className="empty">No members with a phone number match.</div>}
            </div>
          </>
        )}
        <p className="muted sm" style={{ marginTop: 12 }}>{recipients.length} recipient(s) with a phone number on file.</p>
      </div>
      <div className="panel">
        <h2>Message</h2>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your message…" style={{ minHeight: 120 }} />
        <p className="muted sm">{message.length} characters · {segments || 0} SMS segment(s) per recipient (160 chars each).</p>
        {result && <div className={result.ok ? 'muted' : 'err'} style={{ marginBottom: 10 }}>{result.text}</div>}
        <button className="primary" disabled={sending} onClick={send}>{sending ? 'Sending…' : `Send to ${recipients.length}`}</button>
      </div>
    </>
  );
}

/* ---------------- Reports ---------------- */
export function Reports() {
  const { data } = useData();
  const { role } = useAuth();
  const showGiving = can(role, 'giving', 'read');
  const years = [...new Set(data.giving.map((g) => String(g.date).slice(0, 4)))].sort().reverse();
  const [year, setYear] = useState('');
  const y = year || years[0] || String(new Date().getFullYear());

  const yg = data.giving.filter((g) => String(g.date).startsWith(y));
  const byType = {};
  yg.forEach((g) => { byType[g.type] = (byType[g.type] || 0) + Number(g.amount); });
  const byMonth = Array(12).fill(0);
  yg.forEach((g) => { byMonth[Number(String(g.date).slice(5, 7)) - 1] += Number(g.amount); });
  const total = yg.reduce((a, g) => a + Number(g.amount), 0);

  const groups = {};
  data.attendance.forEach((a) => {
    const k = a.date + '|' + a.service;
    if (!groups[k]) groups[k] = { date: a.date, service: a.service, Present: 0, Visitor: 0, Absent: 0 };
    groups[k][a.status] += 1;
  });
  const att = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  const exportable = TABLES.filter((t) => can(role, t, 'read'));

  // Flags active members who haven't shown Present in the last 3 recorded Sunday Services —
  // the kind of "who's fallen off" list a pastor actually needs, not just raw numbers.
  const lastServices = [...new Set(data.attendance.filter((a) => a.status !== 'Visitor').map((a) => a.date + '|' + a.service))]
    .sort().reverse().slice(0, 3);
  const presentRecently = new Set(
    data.attendance.filter((a) => a.status === 'Present' && lastServices.includes(a.date + '|' + a.service)).map((a) => a.person_name),
  );
  const missing = lastServices.length >= 2
    ? data.members.filter((m) => m.status === 'Active' && !presentRecently.has(m.name))
    : [];

  return (
    <>
      <div className="top"><h1>Reports</h1></div>
      {showGiving && (
        <div className="panel">
          <div className="top" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Giving summary</h2>
            <select value={y} onChange={(e) => setYear(e.target.value)}>
              {(years.length ? years : [y]).map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <p><b>Total {y}: {money(total)}</b></p>
          <div className="grid2">
            <div className="tablewrap"><table>
              <thead><tr><th>Type</th><th>Amount</th></tr></thead>
              <tbody>
                {Object.entries(byType).map(([k, v]) => <tr key={k}><td>{k}</td><td>{money(v)}</td></tr>)}
                {!Object.keys(byType).length && <tr><td colSpan="2" className="empty">No giving in {y}.</td></tr>}
              </tbody>
            </table></div>
            <div className="tablewrap"><table>
              <thead><tr><th>Month</th><th>Amount</th></tr></thead>
              <tbody>{byMonth.map((v, i) => <tr key={i}><td>{MONTHS[i]}</td><td>{money(v)}</td></tr>)}</tbody>
            </table></div>
          </div>
        </div>
      )}
      <div className="panel">
        <h2>Attendance by service (latest 12)</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Service</th><th>Present</th><th>Visitors</th><th>Absent</th></tr></thead>
          <tbody>
            {att.map((r) => <tr key={r.date + r.service}><td>{r.date}</td><td>{r.service}</td><td>{r.Present}</td><td>{r.Visitor}</td><td>{r.Absent}</td></tr>)}
            {!att.length && <tr><td colSpan="5" className="empty">No attendance recorded yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="panel">
        <h2>Follow-up: active members missing the last {lastServices.length} recorded service(s)</h2>
        {lastServices.length < 2 ? (
          <p className="muted">Record at least two services in Attendance to see this list.</p>
        ) : missing.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Phone</th><th>Group</th></tr></thead>
            <tbody>{missing.map((m) => <tr key={m.id}><td><b>{m.name}</b></td><td>{m.phone || '—'}</td><td>{m.grp || '—'}</td></tr>)}</tbody>
          </table></div>
        ) : <div className="empty">No one is missing — everyone active showed up recently.</div>}
      </div>
      <div className="panel">
        <h2>Export to Excel (CSV)</h2>
        <div className="btnrow">
          {exportable.map((t) => (
            <button key={t} className="secondary" onClick={() => (data[t].length ? downloadCSV(t, data[t]) : alert('No data to export'))}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------- Users (admin only) ---------------- */
export function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) setMsg(error.message); else { setRows(data); setMsg(''); }
  };
  useEffect(() => { load(); }, []);

  const change = async (id, role) => {
    const { data, error } = await supabase.from('profiles').update({ role }).eq('id', id).select();
    if (error || !data?.length) setMsg(error?.message || 'Not updated (no permission).');
    else load();
  };

  return (
    <>
      <div className="top"><h1>Users</h1><button className="secondary" onClick={load}>Refresh</button></div>
      <div className="panel">
        <p className="muted">
          New sign-ups appear as <b>pending</b> and see nothing until you give them a role.
          <br /><b>admin</b>: everything · <b>finance</b>: giving + read others · <b>secretary</b>: members, attendance, departments, events · <b>viewer</b>: read-only (no giving).
        </p>
        {msg && <div className="err">{msg}</div>}
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id}>
                <td><b>{p.full_name || '—'}</b></td>
                <td>{p.email}</td>
                <td>
                  <select value={p.role} disabled={p.id === user.id} onChange={(e) => change(p.id, e.target.value)}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>{String(p.created_at).slice(0, 10)}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan="4" className="empty">No users.</td></tr>}
            {!rows && <tr><td colSpan="4" className="empty">Loading…</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */
export function Settings() {
  const { user, profile } = useAuth();
  const { data, pending, failed, online, syncError, lastSync, syncNow, discardFailed } = useData();
  return (
    <>
      <div className="top"><h1>Settings</h1></div>
      <div className="panel">
        <h2>Account</h2>
        <p><b>{profile?.full_name || user.email}</b><br /><span className="muted">{user.email} · role: {profile?.role}</span></p>
      </div>
      <div className="panel">
        <h2>Sync</h2>
        <p className="muted">
          {online && !syncError ? 'Connected.' : 'Working offline — changes are saved on this device and sent automatically when the connection returns.'}
          {' '}Unsynced changes: <b>{pending}</b>.{lastSync ? ` Last synced ${lastSync.toLocaleTimeString()}.` : ''}
        </p>
        <button className="secondary" onClick={syncNow}>Sync now</button>
        {failed.length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>Changes the server rejected ({failed.length})</h2>
            <p className="muted">These were not saved (usually a permission problem). The list on screen has been refreshed from the server.</p>
            <ul>
              {failed.map((f, i) => <li key={i}>{f.op} in <b>{f.table}</b>: {f.error}</li>)}
            </ul>
            <button className="secondary" onClick={discardFailed}>Clear this list</button>
          </>
        )}
      </div>
      <div className="panel">
        <h2>Backup</h2>
        <p className="muted">Your data lives in Supabase. Download a copy of what this device can see:</p>
        <button className="secondary" onClick={() => download(`church-backup-${today()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2), 'application/json')}>
          Download JSON backup
        </button>
      </div>
    </>
  );
}
