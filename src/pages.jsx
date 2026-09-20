import { useEffect, useState } from 'react';
import { useAuth, can, ROLES } from './auth';
import { useData, TABLES } from './data';
import { supabase } from './supabase';
import Crud from './Crud';
import { money, today, downloadCSV, download } from './utils';

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
export function Members() {
  return (
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
