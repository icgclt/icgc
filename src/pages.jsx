import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, can, ROLES } from './auth';
import { useData, TABLES } from './data';
import { supabase } from './supabase';
import Crud from './Crud';
import { money, today, downloadCSV, download, parseCSV, uuid } from './utils';

const STATUS = ['Active', 'Inactive', 'Visitor'];
const SERVICES = ['Sunday Service', 'Midweek Service', 'Prayer Meeting', 'Other'];
const OFFERING_CATEGORIES = ['Main Offering', 'Project Offering', "Children's Offering", 'First Fruit', 'Weekday Offering', 'Donation', 'Thanksgiving', 'Pledges'];
const HEADCOUNT_CATEGORIES = ['Children Boys', 'Children Girls', 'Youth Boys', 'Youth Girls', 'Adult Men', 'Adult Women'];
const headcountLabel = (cat) => cat.replace('Youth Boys', 'Omega Boys').replace('Youth Girls', 'Omega Girls');
const badge = (v) => <span className="badge">{v}</span>;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------------- Dashboard ---------------- */
export function Dashboard() {
  const { data } = useData();
  const { role, profile } = useAuth();
  const showGiving = can(role, 'giving', 'read');
  const month = today().slice(0, 7);
  const monthGiving = data.offering_entries.filter((g) => String(g.date).startsWith(month)).reduce((a, g) => a + Number(g.amount), 0);
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
        {showGiving && <div className="card"><div className="label">Offering this month</div><div className="num" style={{ fontSize: 22 }}>{money(monthGiving)}</div></div>}
        <div className="card"><div className="label">Departments</div><div className="num">{data.departments.length}</div></div>
        <div className="card"><div className="label">New visitors</div><div className="num">{data.visitors.filter(v => v.visit_date === today()).length}</div><div className="muted sm">today</div></div>
        <div className="card"><div className="label">Open follow-ups</div><div className="num">{data.follow_ups.filter(f => f.status === 'Open' || f.status === 'In Progress').length}</div></div>
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
            <p key={e.id}><b>{e.title}</b><br /><span className="muted">{e.date}{e.event_time ? ` · ${e.event_time}` : ''}{e.location ? ` · ${e.location}` : ''}</span></p>
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
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = can(role, 'events', 'write');
  const canDel = can(role, 'events', 'del');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...(data.events || [])]
      .filter(e => !s || [e.title, e.location, e.description].some(v => String(v || '').toLowerCase().includes(s)))
      .sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }, [data.events, q]);

  const open = (row=null) => setForm({
    original: row,
    values: {
      title: row?.title || '', date: row?.date || today(), event_time: row?.event_time || '',
      location: row?.location || '', description: row?.description || '',
      recurrence: row?.recurrence || 'none', recurrence_end_date: row?.recurrence_end_date || ''
    }, errors: {}
  });

  const set = (k,v) => setForm(f => ({...f, values:{...f.values,[k]:v}}));

  const submit = async (e) => {
    e.preventDefault();
    const v = form.values;
    if (!v.title.trim() || !v.date) return setForm({...form, errors:{title: !v.title.trim() ? 'Required' : undefined, date: !v.date ? 'Required' : undefined}});
    if (v.recurrence === 'weekly' && !v.recurrence_end_date) return setForm({...form, errors:{recurrence_end_date:'Select the last date for this weekly series.'}});
    if (v.recurrence === 'weekly' && v.recurrence_end_date < v.date) return setForm({...form, errors:{recurrence_end_date:'End date must be on or after the first event date.'}});

    if (form.original) {
      save('events', {...form.original, title:v.title.trim(), date:v.date, event_time:v.event_time.trim(), location:v.location.trim(), description:v.description.trim(), recurrence:v.recurrence, recurrence_end_date:v.recurrence_end_date || null});
    } else {
      const seriesId = v.recurrence === 'weekly' ? uuid() : null;
      const dates = [];
      let d = new Date(v.date + 'T00:00:00');
      const end = v.recurrence === 'weekly' ? new Date(v.recurrence_end_date + 'T00:00:00') : d;
      for (let guard=0; d <= end && guard < 520; guard++) {
        dates.push(new Date(d));
        if (v.recurrence !== 'weekly') break;
        d.setDate(d.getDate()+7);
      }
      dates.forEach(dt => {
        const iso = dt.toISOString().slice(0,10);
        save('events', {
          id: uuid(), title:v.title.trim(), date:iso, event_time:v.event_time.trim(), location:v.location.trim(), description:v.description.trim(),
          recurrence:v.recurrence, recurrence_end_date:v.recurrence === 'weekly' ? v.recurrence_end_date : null,
          series_id:seriesId
        });
      });
    }
    setForm(null);
  };

  return <>
    <div className="top"><div><h1>Events</h1><div className="muted">Create one-time events or recurring weekly events.</div></div>{canWrite && <button className="primary" onClick={()=>open()}>+ Add event</button>}</div>
    <div className="panel"><div className="toolbar"><input placeholder="Search events" value={q} onChange={e=>setQ(e.target.value)} /></div></div>
    <div className="panel"><div className="tablewrap"><table><thead><tr><th>Date</th><th>Event</th><th>Time</th><th>Location</th><th>Repeat</th><th></th></tr></thead><tbody>
      {rows.map(e=><tr key={e.id}><td>{e.date}</td><td><b>{e.title}</b><br/><small>{e.description}</small></td><td>{e.event_time||''}</td><td>{e.location||''}</td><td>{e.recurrence==='weekly' ? `Weekly until ${e.recurrence_end_date}` : 'One-time'}</td><td>{canWrite&&<button onClick={()=>open(e)}>Edit</button>} {canDel&&<button className="danger" onClick={()=>remove('events',e.id)}>Delete</button>}</td></tr>)}
      {!rows.length&&<tr><td colSpan="6" className="empty">No events.</td></tr>}
    </tbody></table></div></div>
    {form && <div className="modal"><form className="modalcard" onSubmit={submit}><h2>{form.original?'Edit event':'Add event'}</h2>
      <div className="formgrid">
        <div><label>Event title *</label><input value={form.values.title} onChange={e=>set('title',e.target.value)} /></div>
        <div><label>First date *</label><input type="date" value={form.values.date} onChange={e=>set('date',e.target.value)} /></div>
        <div><label>Time</label><input value={form.values.event_time} onChange={e=>set('event_time',e.target.value)} placeholder="6:00 PM" /></div>
        <div><label>Location</label><input value={form.values.location} onChange={e=>set('location',e.target.value)} /></div>
        <div><label>Repeat</label><select value={form.values.recurrence} onChange={e=>set('recurrence',e.target.value)}><option value="none">One-time</option><option value="weekly">Every week</option></select></div>
        {form.values.recurrence==='weekly' && <div><label>Repeat until *</label><input type="date" value={form.values.recurrence_end_date} onChange={e=>set('recurrence_end_date',e.target.value)} /><small className="muted">An event is created automatically for each 7-day interval.</small></div>}
        <div className="full"><label>Description</label><textarea value={form.values.description} onChange={e=>set('description',e.target.value)} /></div>
      </div>
      {Object.values(form.errors||{}).filter(Boolean).map((x,i)=><div className="err" key={i}>{x}</div>)}
      <div className="toolbar"><button type="button" onClick={()=>setForm(null)}>Cancel</button><button className="primary">Save event</button></div>
    </form></div>}
  </>;
}


/* ---------------- Event Attendance ---------------- */
export function EventAttendance() {
  const { data, save } = useData();
  const { role } = useAuth();
  const canWrite = can(role, 'attendance', 'write');
  const events = useMemo(() => [...(data.events || [])]
    .filter(e => String(e.date) <= today())
    .sort((a,b) => String(b.date).localeCompare(String(a.date))), [data.events]);
  const [eventId, setEventId] = useState('');
  const [statusMap, setStatusMap] = useState({});

  const event = events.find(e => e.id === eventId);
  const registrations = useMemo(() => (data.event_registrations || []).filter(r => r.event_id === eventId), [data.event_registrations, eventId]);
  const registeredIds = useMemo(() => new Set(registrations.map(r => r.member_id)), [registrations]);
  const members = useMemo(() => {
    const base = [...(data.members || [])].filter(m => m.status !== 'Inactive');
    return registrations.length ? base.filter(m => registeredIds.has(m.id)) : base;
  }, [data.members, registrations.length, registeredIds]);

  useEffect(() => {
    if (!eventId) { setStatusMap({}); return; }
    const rows = (data.attendance || []).filter(a => a.event_id === eventId);
    const next = {};
    rows.forEach(a => { if (a.member_id) next[a.member_id] = a.status; });
    setStatusMap(next);
  }, [eventId, data.attendance]);

  const toggle = (id) => setStatusMap(m => ({...m, [id]: m[id] === 'Present' ? 'Absent' : 'Present'}));
  const markAll = (status) => { const next = {}; members.forEach(m => { next[m.id] = status; }); setStatusMap(next); };

  const saveAll = () => {
    if (!event) return;
    let count = 0;
    members.forEach(m => {
      const status = statusMap[m.id];
      if (!status) return;
      const existing = (data.attendance || []).find(a => a.event_id === event.id && a.member_id === m.id);
      save('attendance', {
        id: existing?.id || uuid(), event_id: event.id, date: event.date,
        service: `Event: ${event.title}`, person_name: m.name, member_id: m.id,
        status, note: existing?.note || `Event occurrence attendance: ${event.title}`
      });
      count++;
    });
    alert(`Saved ${count} attendance record${count === 1 ? '' : 's'} for ${event.title}.`);
  };

  const present = members.filter(m => statusMap[m.id] === 'Present').length;
  const absent = members.filter(m => statusMap[m.id] === 'Absent').length;
  const seriesId = event?.series_id || event?.id;
  const seriesEvents = useMemo(() => {
    if (!event) return [];
    return [...(data.events || [])].filter(e => (e.series_id || e.id) === seriesId && String(e.date) <= today()).sort((a,b) => String(a.date).localeCompare(String(b.date)));
  }, [data.events, event, seriesId]);
  const seriesReport = seriesEvents.map(e => {
    const rows = (data.attendance || []).filter(a => a.event_id === e.id);
    return {...e, presentCount: rows.filter(a=>a.status==='Present').length, absentCount: rows.filter(a=>a.status==='Absent').length, visitorCount: rows.filter(a=>a.status==='Visitor').length};
  });
  const seriesTotalPresent = seriesReport.reduce((n,r)=>n+r.presentCount,0);
  const seriesAvg = seriesReport.length ? Math.round(seriesTotalPresent / seriesReport.length) : 0;

  return <>
    <div className="top"><div><h1>Event Attendance</h1><div className="muted">Record attendance separately for each event occurrence. Weekly events have separate attendance records.</div></div></div>
    <div className="panel">
      <div className="toolbar">
        <select value={eventId} onChange={e => setEventId(e.target.value)} style={{minWidth:320}}><option value="">Select event occurrence</option>{events.map(e => <option key={e.id} value={e.id}>{e.date} · {e.title}{e.event_time ? ` · ${e.event_time}` : ''}</option>)}</select>
        {event && canWrite && <><button onClick={() => markAll('Present')}>Mark all present</button><button onClick={() => markAll('Absent')}>Mark all absent</button><button className="primary" onClick={saveAll}>Save attendance</button></>}
      </div>
    </div>
    {event && <div className="cards"><div className="card"><span className="label">Event</span><strong>{event.title}</strong></div><div className="card"><span className="label">Date</span><strong>{event.date}</strong></div><div className="card"><span className="label">Present</span><strong>{present}</strong></div><div className="card"><span className="label">Absent</span><strong>{absent}</strong></div></div>}
    {event && <div className="panel"><h2>{event.title} attendance</h2><div className="muted" style={{marginBottom:12}}>{event.date} {event.event_time || ''} {event.location ? `· ${event.location}` : ''}{registrations.length ? ` · ${registrations.length} registered` : ''}</div><div className="tablewrap"><table><thead><tr><th>Member</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>
      {members.map(m => <tr key={m.id}><td><b>{m.name}</b><br/><small>{m.member_code || ''}</small></td><td>{m.phone || ''}</td><td>{statusMap[m.id] ? badge(statusMap[m.id]) : <span className="muted">Not marked</span>}</td><td>{canWrite && <button onClick={() => toggle(m.id)}>{statusMap[m.id] === 'Present' ? 'Mark absent' : 'Mark present'}</button>}</td></tr>)}
      {!members.length && <tr><td colSpan="4" className="empty">No members found for this occurrence.</td></tr>}
    </tbody></table></div></div>}
    {event && <div className="panel"><div className="top"><div><h2 style={{margin:0}}>Attendance report for this event series</h2><div className="muted">Each occurrence is shown separately.</div></div></div><div className="cards"><div className="card"><span className="label">Occurrences</span><strong>{seriesReport.length}</strong></div><div className="card"><span className="label">Total present</span><strong>{seriesTotalPresent}</strong></div><div className="card"><span className="label">Average present</span><strong>{seriesAvg}</strong></div></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>Time</th><th>Present</th><th>Absent</th><th>Visitors</th><th></th></tr></thead><tbody>
      {seriesReport.map(r=><tr key={r.id}><td>{r.date}</td><td>{r.event_time || ''}</td><td><b>{r.presentCount}</b></td><td>{r.absentCount}</td><td>{r.visitorCount}</td><td><button onClick={()=>setEventId(r.id)}>Open</button></td></tr>)}
      {!seriesReport.length && <tr><td colSpan="6" className="empty">No occurrences found.</td></tr>}
    </tbody></table></div></div>}
  </>;
}

/* ---------------- Service Timer ---------------- */
export function ServiceTimer() {
  const KEY = 'cm:service-timer:v1';
  const defaults = [{id:uuid(),person:'Worship Leader',role:'Worship',minutes:15},{id:uuid(),person:'Announcements',role:'Announcements',minutes:5},{id:uuid(),person:'Offering',role:'Offering',minutes:10},{id:uuid(),person:'Preacher',role:'Sermon',minutes:45}];
  const [items,setItems]=useState(()=>{try{const x=JSON.parse(localStorage.getItem(KEY));return Array.isArray(x)&&x.length?x:defaults;}catch{return defaults;}});
  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items));}catch{}},[items]);
  const add=()=>setItems(x=>[...x,{id:uuid(),person:'New person',role:'Programme item',minutes:5}]);
  const update=(id,k,v)=>setItems(x=>x.map(r=>r.id===id?{...r,[k]:k==='minutes'?Math.max(1,Number(v)||1):v}:r));
  const remove=id=>setItems(x=>x.filter(r=>r.id!==id));
  return <>
    <div className="top"><div><h1>Service Countdown · Timer Setup</h1><div className="muted">Set the people or programme items and their durations. Use Live Countdown when the service starts.</div></div></div>
    <div className="panel"><div className="toolbar"><button onClick={add}>+ Add programme item</button><button onClick={()=>setItems(defaults.map(x=>({...x,id:uuid()})))}>Restore sample</button></div></div>
    <div className="panel"><div className="tablewrap"><table><thead><tr><th>#</th><th>Person / item</th><th>Role</th><th>Minutes</th><th></th></tr></thead><tbody>{items.map((r,i)=><tr key={r.id}><td>{i+1}</td><td><input value={r.person} onChange={e=>update(r.id,'person',e.target.value)}/></td><td><input value={r.role} onChange={e=>update(r.id,'role',e.target.value)}/></td><td><input type="number" min="1" value={r.minutes} onChange={e=>update(r.id,'minutes',e.target.value)} style={{width:90}}/></td><td className="actions"><button className="danger" onClick={()=>remove(r.id)}>Remove</button></td></tr>)}</tbody></table></div></div>
    <div className="panel"><h2>Ready for service</h2><p className="muted">Go to <b>Service Countdown → Live Countdown</b> to select the current item and display its countdown.</p></div>
  </>;
}

export function ServiceTimerLive() {
  const KEY='cm:service-timer:v1';
  const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem(KEY))||[];}catch{return[];}});
  const [active,setActive]=useState(0),[remaining,setRemaining]=useState(0),[running,setRunning]=useState(false),[overtime,setOvertime]=useState(false);
  useEffect(()=>{const load=()=>{try{const x=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(x))setItems(x);}catch{}};load();window.addEventListener('storage',load);return()=>window.removeEventListener('storage',load);},[]);
  useEffect(()=>{if(active>=items.length)setActive(Math.max(0,items.length-1));},[items.length,active]);
  useEffect(()=>{if(!running)return;const t=setInterval(()=>setRemaining(v=>{if(v<=1){setRunning(false);setOvertime(true);return 0;}return v-1;}),1000);return()=>clearInterval(t);},[running]);
  const start=i=>{setActive(i);setRemaining(Math.max(1,Number(items[i]?.minutes)||1)*60);setOvertime(false);setRunning(true);};
  const reset=()=>{if(!items[active])return;setRemaining(Math.max(1,Number(items[active].minutes)||1)*60);setOvertime(false);setRunning(false);};
  const next=()=>{if(active<items.length-1)start(active+1);};
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  if(!items.length)return <div className="panel"><h1>Live Countdown</h1><p className="muted">No timer items yet. Add them under Service Countdown → Timer Setup.</p></div>;
  const current=items[active];
  return <div className="timer-live-page">
    <div className="timer-live-head"><div><div className="timer-live-church">{import.meta.env.VITE_CHURCH_NAME || 'Church'}</div><h1>{current?.person||'Service Countdown'}</h1><div className="timer-live-role">{current?.role||''}</div></div><select value={active} onChange={e=>{setRunning(false);setOvertime(false);setActive(Number(e.target.value));setRemaining(0);}}>{items.map((x,i)=><option key={x.id} value={i}>{i+1}. {x.person}</option>)}</select></div>
    <div className="timer-live-main"><div className={'timer-live-clock '+(overtime?'overtime':'')}>{overtime?'TIME UP':fmt(remaining)}</div><div className="timer-live-meta">{current?.minutes||0} minutes</div><div className="timer-live-actions"><button className="primary" onClick={()=>remaining?setRunning(x=>!x):start(active)}>{running?'Pause':remaining?'Resume':'Start'}</button><button className="secondary" onClick={reset}>Reset</button><button className="secondary" onClick={next} disabled={active>=items.length-1}>Next</button></div><p className="muted sm">This view fills the available screen for projection.</p></div>
  </div>;
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

/* ---------------- Offerings (detailed categories) ---------------- */
export function Offerings() {
  return (
    <Crud
      table="offering_entries" title="Offerings" noun="offering entry"
      sortKey="date" sortDir="desc" searchKeys={['note']}
      filters={[{ key: 'category', label: 'All categories', options: OFFERING_CATEGORIES }]}
      defaults={{ date: today(), category: 'Main Offering' }}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'category', label: 'Category', type: 'select', options: OFFERING_CATEGORIES, required: true },
        { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: -1, required: true },
        { key: 'note', label: 'Note' },
      ]}
      columns={[
        { label: 'Date', key: 'date' },
        { label: 'Category', key: 'category' },
        { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
        { label: 'Note', key: 'note' },
      ]}
    />
  );
}

/* ---------------- First Fruit / Welfare Dues: shared monthly grid ---------------- */
// Both funds follow the identical "member x 12 months" pattern from the old workbooks —
// one editable grid, keyed by which roster and which fund it writes to.
function ContributionsGrid({ fund, roster, title }) {
  const { data, save } = useData();
  const [year, setYear] = useState(new Date().getFullYear());
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState({}); // `${name}|${month}` -> string value

  const existing = useMemo(() => {
    const map = new Map();
    data.member_contributions.forEach((c) => { if (c.fund === fund && c.year === year) map.set(c.person_name + '|' + c.month, c); });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.member_contributions, fund, year]);

  useEffect(() => { setEdits({}); }, [year, fund]);

  const shown = roster.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));

  const valueFor = (name, month) => {
    const k = name + '|' + month;
    if (k in edits) return edits[k];
    const rec = existing.get(k);
    return rec ? String(rec.amount) : '';
  };
  const setValue = (name, month, v) => setEdits((e) => ({ ...e, [name + '|' + month]: v }));
  const rowTotal = (name) => MONTHS.reduce((s, _, i) => s + (Number(valueFor(name, i + 1)) || 0), 0);
  const monthTotal = (month) => shown.reduce((s, m) => s + (Number(valueFor(m.name, month)) || 0), 0);
  const grandTotal = shown.reduce((s, m) => s + rowTotal(m.name), 0);

  const saveAll = () => {
    let n = 0;
    Object.entries(edits).forEach(([k, v]) => {
      const [name, monthStr] = k.split('|');
      const month = Number(monthStr);
      const amount = Number(v) || 0;
      const rec = existing.get(k);
      if (!rec && amount === 0) return;
      save('member_contributions', { id: rec ? rec.id : uuid(), fund, person_name: name, year, month, amount });
      n++;
    });
    setEdits({});
    alert(n ? `Saved ${n} entr${n === 1 ? 'y' : 'ies'}.` : 'No changes to save.');
  };

  return (
    <>
      <div className="top">
        <h1>{title}</h1>
        <button className="primary" onClick={saveAll}>Save changes</button>
      </div>
      <div className="panel">
        <div className="toolbar">
          <div className="fld"><small>Year</small><input type="number" value={year} style={{ width: 90 }} onChange={(e) => setYear(Number(e.target.value) || year)} /></div>
          <input placeholder="Search member…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tablewrap">
          <table className="gridtable">
            <thead><tr><th>Name</th>{MONTHS.map((m) => <th key={m}>{m}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.name}</b></td>
                  {MONTHS.map((_, i) => (
                    <td key={i}><input type="number" step="0.01" className="cellinput" value={valueFor(m.name, i + 1)} onChange={(e) => setValue(m.name, i + 1, e.target.value)} /></td>
                  ))}
                  <td><b>{money(rowTotal(m.name))}</b></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={14} className="empty">No members match.</td></tr>}
            </tbody>
            {shown.length > 0 && (
              <tfoot><tr><td><b>Monthly total</b></td>{MONTHS.map((_, i) => <td key={i}><b>{money(monthTotal(i + 1))}</b></td>)}<td><b>{money(grandTotal)}</b></td></tr></tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

export function FirstFruit() {
  const { data } = useData();
  const roster = [...data.members].filter((m) => m.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name));
  return <ContributionsGrid fund="First Fruit" roster={roster} title="First Fruit Register" />;
}

export function MonthlyContribution() {
  const { data } = useData();
  const roster = [...data.members].filter(m => m.status !== 'Inactive').sort((a,b)=>a.name.localeCompare(b.name));
  return <ContributionsGrid fund="Monthly Contribution" roster={roster} title="Monthly Contribution Register" />;
}

export function WelfareDues() {
  const { data } = useData();
  const roster = [...data.members].filter((m) => m.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name));
  return <ContributionsGrid fund="Welfare Dues" roster={roster} title="Welfare Dues" />;
}

/* ---------------- Welfare Fund ---------------- */
export function WelfareMembers() {
  return (
    <Crud
      table="welfare_members" title="Welfare Members" noun="welfare member"
      sortKey="name" searchKeys={['name', 'ac_no', 'phone', 'next_of_kin']}
      filters={[{ key: 'status', label: 'All statuses', options: ['Active', 'Inactive'] }]}
      defaults={{ status: 'Active' }}
      fields={[
        { key: 'ac_no', label: 'AC/NO' },
        { key: 'name', label: 'Full name', required: true },
        { key: 'sex', label: 'Sex', type: 'select', options: ['M', 'F'] },
        { key: 'date_registered', label: 'Date registered', type: 'date' },
        { key: 'phone', label: 'Phone' },
        { key: 'department', label: 'Department' },
        { key: 'next_of_kin', label: 'Next of kin' },
        { key: 'registration_dues', label: 'Registration dues (GHS)', type: 'number', step: '0.01', gt: -1 },
        { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'], required: true },
      ]}
      columns={[
        { label: 'AC/NO', key: 'ac_no' },
        { label: 'Name', render: (m) => <b>{m.name}</b> },
        { label: 'Sex', key: 'sex' },
        { label: 'Phone', key: 'phone' },
        { label: 'Next of kin', key: 'next_of_kin' },
        { label: 'Status', render: (m) => badge(m.status) },
      ]}
    />
  );
}

export function WelfareFund() {
  const { data } = useData();
  const income = data.welfare_transactions.filter((t) => t.kind === 'Income').reduce((s, t) => s + Number(t.amount), 0);
  const expenditure = data.welfare_transactions.filter((t) => t.kind === 'Expenditure').reduce((s, t) => s + Number(t.amount), 0);
  return (
    <>
      <div className="top"><h1>Welfare Fund</h1></div>
      <div className="cards">
        <div className="card"><div className="label">Total income</div><div className="num" style={{ fontSize: 22 }}>{money(income)}</div></div>
        <div className="card"><div className="label">Total expenditure</div><div className="num" style={{ fontSize: 22 }}>{money(expenditure)}</div></div>
        <div className="card"><div className="label">Balance</div><div className="num" style={{ fontSize: 22 }}>{money(income - expenditure)}</div></div>
      </div>
      <Crud
        table="welfare_transactions" title="Transactions" noun="transaction"
        sortKey="date" sortDir="desc" searchKeys={['item', 'note']}
        filters={[{ key: 'kind', label: 'All', options: ['Income', 'Expenditure'] }]}
        defaults={{ date: today(), kind: 'Income' }}
        fields={[
          { key: 'date', label: 'Date', type: 'date', required: true },
          { key: 'kind', label: 'Type', type: 'select', options: ['Income', 'Expenditure'], required: true },
          { key: 'item', label: 'Item (e.g. Contribution, Offering, Donation, T&T)', required: true },
          { key: 'amount', label: 'Amount (GHS)', type: 'number', step: '0.01', gt: -1, required: true },
          { key: 'note', label: 'Note (e.g. transport breakdown, purpose)', type: 'textarea', full: true },
        ]}
        columns={[
          { label: 'Date', key: 'date' },
          { label: 'Type', render: (r) => badge(r.kind) },
          { label: 'Item', key: 'item' },
          { label: 'Amount', render: (r) => <b>{money(r.amount)}</b> },
          { label: 'Note', key: 'note' },
        ]}
      />
    </>
  );
}

/* ---------------- Headcount Attendance (by demographic category) ---------------- */
export function HeadcountAttendance() {
  const { data, save } = useData();
  const [date, setDate] = useState(today());
  const [service, setService] = useState('Sunday Service');
  const [edits, setEdits] = useState({});
  const existing = useMemo(() => { const map=new Map(); data.attendance_headcount.forEach(r=>{if(r.date===date&&r.service===service)map.set(r.category,r);}); return map; }, [data.attendance_headcount,date,service]);
  useEffect(()=>setEdits({}),[date,service]);
  const valueFor=cat=>(cat in edits?edits[cat]:String(existing.get(cat)?.count??''));
  const val=cat=>Number(valueFor(cat))||0;
  const childrenTotal=val('Children Boys')+val('Children Girls');
  const omegaTotal=val('Youth Boys')+val('Youth Girls');
  const adultTotal=val('Adult Men')+val('Adult Women');
  const total=childrenTotal+omegaTotal+adultTotal;
  const saveAll=()=>{let n=0;HEADCOUNT_CATEGORIES.forEach(cat=>{if(!(cat in edits))return;const count=Number(edits[cat])||0;const rec=existing.get(cat);save('attendance_headcount',{id:rec?rec.id:uuid(),date,service,category:cat,count});n++;});setEdits({});alert(n?`Saved headcount for ${n} categor${n===1?'y':'ies'}. Total: ${total}.`:'No changes to save.');};
  const history=[...new Set(data.attendance_headcount.map(r=>r.date+'|'+r.service))].sort().reverse().slice(0,10).map(k=>{const[d,s]=k.split('|');const rows=data.attendance_headcount.filter(r=>r.date===d&&r.service===s);const get=c=>rows.find(r=>r.category===c)?.count||0;return{date:d,service:s,children:get('Children Boys')+get('Children Girls'),omega:get('Youth Boys')+get('Youth Girls'),adults:get('Adult Men')+get('Adult Women'),total:rows.reduce((sum,r)=>sum+Number(r.count||0),0)};});
  return <><div className="top"><h1>Headcount Attendance</h1><button className="primary" onClick={saveAll}>Save headcount</button></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Date</small><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}>{SERVICES.map(s=><option key={s}>{s}</option>)}</select></div></div>
      <div className="cards"><div className="card"><div className="label">Adults</div><strong>{adultTotal}</strong></div><div className="card"><div className="label">Omega</div><strong>{omegaTotal}</strong></div><div className="card"><div className="label">Children</div><strong>{childrenTotal}</strong></div><div className="card"><div className="label">Total attendance</div><strong>{total}</strong></div></div>
      <h2>Detailed breakdown</h2><div className="grid2">{HEADCOUNT_CATEGORIES.map(cat=><div className="fld" key={cat}><small>{headcountLabel(cat)}</small><input type="number" min="0" value={valueFor(cat)} onChange={e=>setEdits(ed=>({...ed,[cat]:e.target.value}))}/></div>)}</div>
    </div>
    <div className="panel"><h2>Recent headcount breakdowns</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Adults</th><th>Omega</th><th>Children</th><th>Total</th></tr></thead><tbody>{history.map(r=><tr key={r.date+r.service}><td>{r.date}</td><td>{r.service}</td><td>{r.adults}</td><td>{r.omega}</td><td>{r.children}</td><td><b>{r.total}</b></td></tr>)}{!history.length&&<tr><td colSpan="6" className="empty">No headcounts recorded yet.</td></tr>}</tbody></table></div></div>
  </>;
}

/* ---------------- Reports ---------------- */
export function Reports() {
  const { data } = useData();
  const { role } = useAuth();
  const showGiving = can(role, 'giving', 'read');
  const showOfferings = can(role, 'offering_entries', 'read');
  const years = [...new Set([...data.giving.map((g) => String(g.date).slice(0, 4)), ...data.offering_entries.map((o) => String(o.date).slice(0, 4))])].sort().reverse();
  const [year, setYear] = useState('');
  const y = year || years[0] || String(new Date().getFullYear());

  const yg = data.giving.filter((g) => String(g.date).startsWith(y));
  const byType = {};
  yg.forEach((g) => { byType[g.type] = (byType[g.type] || 0) + Number(g.amount); });
  const byMonth = Array(12).fill(0);
  yg.forEach((g) => { byMonth[Number(String(g.date).slice(5, 7)) - 1] += Number(g.amount); });
  const total = yg.reduce((a, g) => a + Number(g.amount), 0);

  const yo = data.offering_entries.filter((o) => String(o.date).startsWith(y));
  const byCategory = {};
  yo.forEach((o) => { byCategory[o.category] = (byCategory[o.category] || 0) + Number(o.amount); });
  const offByMonth = Array(12).fill(0);
  yo.forEach((o) => { offByMonth[Number(String(o.date).slice(5, 7)) - 1] += Number(o.amount); });
  const offTotal = yo.reduce((a, o) => a + Number(o.amount), 0);

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
      {showOfferings && (
        <div className="panel">
          <div className="top" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Offerings summary</h2>
            <select value={y} onChange={(e) => setYear(e.target.value)}>
              {(years.length ? years : [y]).map((x) => <option key={x}>{x}</option>)}
            </select>
          </div>
          <p><b>Total {y}: {money(offTotal)}</b></p>
          <div className="grid2">
            <div className="tablewrap"><table>
              <thead><tr><th>Category</th><th>Amount</th></tr></thead>
              <tbody>
                {OFFERING_CATEGORIES.map((c) => <tr key={c}><td>{c}</td><td>{money(byCategory[c] || 0)}</td></tr>)}
                {!yo.length && <tr><td colSpan="2" className="empty">No offerings recorded in {y}.</td></tr>}
              </tbody>
            </table></div>
            <div className="tablewrap"><table>
              <thead><tr><th>Month</th><th>Amount</th></tr></thead>
              <tbody>{offByMonth.map((v, i) => <tr key={i}><td>{MONTHS[i]}</td><td>{money(v)}</td></tr>)}</tbody>
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
// Calls the admin-users edge function (needs the service key, so it can't run in the browser).
async function adminCall(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let m = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch { /* keep default */ }
    if (/Failed to send|fetch/i.test(m)) m = 'Could not reach the server. Check your internet connection (and that the admin-users function is deployed).';
    throw new Error(m);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
const randomPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (n) => chars[n % chars.length]).join('');
};

function UserDialog({ mode, target, onClose, onDone }) {
  // mode: 'create' | 'reset'
  const [f, setF] = useState({ full_name: '', email: '', role: 'viewer', password: randomPassword() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (f.password.length < 6) return setErr('Password must be at least 6 characters.');
    setBusy(true);
    try {
      if (mode === 'create') await adminCall({ action: 'create', ...f });
      else await adminCall({ action: 'reset_password', user_id: target.id, password: f.password });
      setDone({ email: mode === 'create' ? f.email : target.email, password: f.password });
      onDone();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalbox" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead"><h2>{mode === 'create' ? 'Create user account' : 'Reset password'}</h2><button className="x" onClick={onClose}>×</button></div>
        {done ? (
          <>
            <p>{mode === 'create' ? 'Account created.' : 'Password changed.'} Give these details to the user (they can change the password later in Settings):</p>
            <pre>{`Email:    ${done.email}\nPassword: ${done.password}`}</pre>
            <div className="btnrow">
              <button className="secondary" onClick={() => navigator.clipboard?.writeText(`Email: ${done.email}\nPassword: ${done.password}`)}>Copy</button>
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {mode === 'reset' && <p className="muted">New password for <b>{target.full_name || target.email}</b> ({target.email}).</p>}
            <div className="formgrid">
              {mode === 'create' && <>
                <div className="fld"><small>Full name</small><input value={f.full_name} onChange={set('full_name')} required /></div>
                <div className="fld"><small>Email</small><input type="email" value={f.email} onChange={set('email')} required /></div>
                <div className="fld"><small>Role</small>
                  <select value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                </div>
              </>}
              <div className="fld"><small>{mode === 'create' ? 'Password' : 'New password'}</small>
                <div className="btnrow" style={{ flexWrap: 'nowrap' }}>
                  <input value={f.password} onChange={set('password')} required style={{ flex: 1 }} />
                  <button type="button" className="secondary" onClick={() => setF({ ...f, password: randomPassword() })}>Generate</button>
                </div>
              </div>
            </div>
            {err && <div className="err" style={{ margin: '10px 0' }}>{err}</div>}
            <div style={{ marginTop: 14 }}><button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'create' ? 'Create account' : 'Reset password'}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}

export function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState('');
  const [dialog, setDialog] = useState(null);

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

  const remove = async (p) => {
    if (!confirm(`Delete the account for ${p.full_name || p.email}? They will no longer be able to sign in. Records they created are kept.`)) return;
    try { await adminCall({ action: 'delete', user_id: p.id }); load(); } catch (ex) { setMsg(ex.message); }
  };

  return <>
    <div className="top">
      <h1>Users</h1>
      <div className="btnrow"><button className="secondary" onClick={load}>Refresh</button><button className="primary" onClick={() => setDialog({ mode: 'create' })}>+ Create user</button></div>
    </div>
    <div className="panel">
      <p className="muted">Create accounts here and choose each person's role, or approve people who signed up themselves. This church uses a single-church structure, so there is no branch assignment.</p>
      {msg && <div className="err">{msg}</div>}
      <div className="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
        <tbody>{(rows || []).map((p) => <tr key={p.id}>
          <td><b>{p.full_name || '—'}</b></td><td>{p.email}</td>
          <td><select value={p.role} disabled={p.id === user.id} onChange={(e) => change(p.id, e.target.value)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></td>
          <td>{String(p.created_at).slice(0, 10)}</td>
          <td className="actions"><button className="secondary" onClick={() => setDialog({ mode: 'reset', target: p })}>Reset password</button>{p.id !== user.id && <button className="danger" onClick={() => remove(p)}>Delete</button>}</td>
        </tr>)}
        {rows && !rows.length && <tr><td colSpan="5" className="empty">No users.</td></tr>}
        {!rows && <tr><td colSpan="5" className="empty">Loading…</td></tr>}</tbody>
      </table></div>
    </div>
    {dialog && <UserDialog {...dialog} onClose={() => setDialog(null)} onDone={load} />}
  </>;
}

export function Visitors() {
  return <Crud table="visitors" title="Visitors" noun="visitor" sortKey="visit_date" sortDir="desc" searchKeys={['name','phone','email','source','notes']}
    filters={[{key:'status',label:'All statuses',options:['New','Contacted','Connected','Not Connected','Member']},{key:'visit_type',label:'All visit types',options:['First Visit','Returning Visitor','Special Service','Event','Other'] }]}
    defaults={{visit_date:today(),status:'New',visit_type:'First Visit'}}
    fields={[
      {key:'visit_date',label:'Visit date',type:'date',required:true},{key:'name',label:'Full name',required:true},{key:'phone',label:'Phone',type:'tel'},{key:'email',label:'Email',type:'email'},
      {key:'gender',label:'Gender',type:'select',options:['Male','Female']},{key:'visit_type',label:'Visit type',type:'select',options:['First Visit','Returning Visitor','Special Service','Event','Other'],required:true},
      {key:'source',label:'How did they hear about us?'},{key:'address',label:'Address',full:true},{key:'status',label:'Status',type:'select',options:['New','Contacted','Connected','Not Connected','Member'],required:true},
      {key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'visit_date'},{label:'Visitor',render:r=><><b>{r.name}</b><br/><small>{r.phone||'No phone'}</small></>},{label:'Visit type',key:'visit_type'},{label:'Status',render:r=>badge(r.status)},{label:'Source',key:'source'}]}/>
}

export function Groups() {
  return <Crud table="groups" title="Groups / House Fellowships" noun="group" sortKey="name" searchKeys={['name','leader','location']}
    filters={[{key:'status',label:'All statuses',options:['Active','Inactive']}]}
    defaults={{status:'Active',group_type:'House Fellowship'}}
    fields={[
      {key:'name',label:'Group name',required:true},{key:'group_type',label:'Type',required:true},{key:'leader',label:'Leader'},{key:'assistant_leader',label:'Assistant leader'},
      {key:'meeting_day',label:'Meeting day'},{key:'meeting_time',label:'Meeting time'},{key:'location',label:'Location'},
      {key:'status',label:'Status',type:'select',options:['Active','Inactive'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Group',render:r=><b>{r.name}</b>},{label:'Type',key:'group_type'},{label:'Leader',key:'leader'},{label:'Meeting',render:r=><>{r.meeting_day||''}{r.meeting_time?` · ${r.meeting_time}`:''}</>},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function FollowUps() {
  return <Crud table="follow_ups" title="Follow-up" noun="follow-up" sortKey="date" sortDir="desc" searchKeys={['person_name','phone','reason','assigned_to','outcome']}
    filters={[{key:'status',label:'All statuses',options:['Open','In Progress','Completed','Closed']},{key:'category',label:'All categories',options:['Visitor','New Convert','Member','Youth','Family','Other']}]}
    defaults={{date:today(),status:'Open',category:'Member',method:'Phone'}}
    fields={[
      {key:'date',label:'Date',type:'date',required:true},{key:'person_name',label:'Person',required:true},{key:'phone',label:'Phone',type:'tel'},
      {key:'category',label:'Category',type:'select',options:['Visitor','New Convert','Member','Youth','Family','Other'],required:true},{key:'reason',label:'Reason',required:true},
      {key:'assigned_to',label:'Assigned to'},{key:'method',label:'Method',type:'select',options:['Phone','WhatsApp','Visit','SMS','In Person']},
      {key:'outcome',label:'Outcome',type:'textarea',full:true},{key:'next_action',label:'Next action'},{key:'next_date',label:'Next follow-up',type:'date'},
      {key:'status',label:'Status',type:'select',options:['Open','In Progress','Completed','Closed'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'date'},{label:'Person',render:r=><><b>{r.person_name}</b><br/><small>{r.category}</small></>},{label:'Reason',key:'reason'},{label:'Assigned',key:'assigned_to'},{label:'Next date',key:'next_date'},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function PrayerRequests() {
  return <Crud table="prayer_requests" title="Prayer Requests" noun="prayer request" sortKey="date" sortDir="desc" searchKeys={['requester','request','category','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['New','Assigned','Praying','Answered','Closed']},{key:'category',label:'All categories',options:['General','Healing','Family','Finance','Work','Salvation','Thanksgiving','Other']}]}
    defaults={{date:today(),status:'New',category:'General',confidential:false}}
    fields={[
      {key:'date',label:'Date',type:'date',required:true},{key:'requester',label:'Requester',required:true},{key:'phone',label:'Phone',type:'tel'},
      {key:'category',label:'Category',type:'select',options:['General','Healing','Family','Finance','Work','Salvation','Thanksgiving','Other']},
      {key:'request',label:'Prayer request',type:'textarea',required:true,full:true},{key:'confidential',label:'Confidential',type:'checkbox'},
      {key:'assigned_to',label:'Assigned to'},{key:'status',label:'Status',type:'select',options:['New','Assigned','Praying','Answered','Closed'],required:true},
      {key:'answered_date',label:'Answered date',type:'date'},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'date'},{label:'Requester',key:'requester'},{label:'Request',render:r=><span title={r.request}>{String(r.request||'').slice(0,70)}{String(r.request||'').length>70?'…':''}</span>},{label:'Assigned',key:'assigned_to'},{label:'Status',render:r=>badge(r.status)}]}/>
}


export function ServicePlans() {
  return <Crud table="service_plans" title="Service Plans" noun="service item" sortKey="service_date" searchKeys={['service_name','service_item','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['Planned','Confirmed','Completed','Cancelled']}]}
    defaults={{service_date:today(),service_name:'Sunday Service',item_order:1,status:'Planned'}}
    fields={[
      {key:'service_date',label:'Service date',type:'date',required:true},{key:'service_name',label:'Service',required:true},{key:'item_order',label:'Order',type:'number',min:1,required:true},
      {key:'service_item',label:'Service item',required:true},{key:'assigned_to',label:'Assigned to'},{key:'duration',label:'Duration'},
      {key:'status',label:'Status',type:'select',options:['Planned','Confirmed','Completed','Cancelled'],required:true},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'service_date'},{label:'Service',key:'service_name'},{label:'#',key:'item_order'},{label:'Item',key:'service_item'},{label:'Assigned',key:'assigned_to'},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function PastoralCare() {
  return <Crud table="pastoral_cases" title="Pastoral Care" noun="case" sortKey="opened_date" sortDir="desc" searchKeys={['person_name','category','assigned_to']}
    filters={[{key:'status',label:'All statuses',options:['Open','In Progress','Resolved','Closed']},{key:'priority',label:'All priorities',options:['Low','Normal','High','Urgent']}]}
    defaults={{opened_date:today(),status:'Open',priority:'Normal'}}
    fields={[
      {key:'opened_date',label:'Opened date',type:'date',required:true},{key:'person_name',label:'Person',required:true},{key:'category',label:'Category',required:true},
      {key:'assigned_to',label:'Assigned pastor / leader'},{key:'priority',label:'Priority',type:'select',options:['Low','Normal','High','Urgent'],required:true},
      {key:'status',label:'Status',type:'select',options:['Open','In Progress','Resolved','Closed'],required:true},{key:'next_follow_up',label:'Next follow-up',type:'date'},
      {key:'private_notes',label:'Confidential notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Opened',key:'opened_date'},{label:'Person',key:'person_name'},{label:'Category',key:'category'},{label:'Assigned',key:'assigned_to'},{label:'Priority',render:r=>badge(r.priority)},{label:'Status',render:r=>badge(r.status)}]}/>
}

export function AuditLog() {
  const { role } = useAuth();
  const [rows,setRows]=useState([]); const [error,setError]=useState('');
  useEffect(()=>{ if(role!=='admin') return; supabase.from('audit_log').select('*').order('at',{ascending:false}).limit(300).then(({data,error})=>{if(error)setError(error.message);else setRows(data||[]);}); },[role]);
  if(role!=='admin') return <div className="panel"><h1>Audit Log</h1><p className="muted">Admin access only.</p></div>;
  return <><div className="top"><h1>Audit Log</h1><button className="secondary" onClick={()=>supabase.from('audit_log').select('*').order('at',{ascending:false}).limit(300).then(({data,error})=>{if(error)setError(error.message);else setRows(data||[]);})}>Refresh</button></div>
    <div className="panel">{error&&<div className="err">{error}</div>}<div className="tablewrap"><table><thead><tr><th>Time</th><th>Table</th><th>Action</th><th>Record</th><th>Actor</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.table_name}</td><td>{badge(r.action)}</td><td>{r.row_id}</td><td>{r.actor||'System'}</td></tr>)}{!rows.length&&<tr><td colSpan="5" className="empty">No audit records.</td></tr>}</tbody></table></div></div></>;
}

/* ---------------- Settings ---------------- */
function ChangePassword() {
  const { updatePassword } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (p1.length < 6) return setMsg({ bad: true, t: 'Password must be at least 6 characters.' });
    if (p1 !== p2) return setMsg({ bad: true, t: 'The two passwords do not match.' });
    const { error } = await updatePassword(p1);
    if (error) setMsg({ bad: true, t: error.message });
    else { setMsg({ t: 'Password changed.' }); setP1(''); setP2(''); }
  }
  return (
    <form onSubmit={submit} style={{ marginTop: 14, maxWidth: 360 }}>
      <h2>Change password</h2>
      <label>New password</label><input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      <label>Confirm new password</label><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      {msg && <div className={msg.bad ? 'err' : 'muted'} style={{ marginBottom: 10 }}>{msg.t}</div>}
      <button className="primary">Update password</button>
    </form>
  );
}

export function Settings() {
  const { user, profile } = useAuth();
  const { data, pending, failed, online, syncError, lastSync, syncNow, discardFailed } = useData();
  return (
    <>
      <div className="top"><h1>Settings</h1></div>
      <div className="panel">
        <h2>Account</h2>
        <p><b>{profile?.full_name || user.email}</b><br /><span className="muted">{user.email} · role: {profile?.role}</span></p>
        <ChangePassword />
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
            <p className="muted">These changes were not applied. A conflict means another user changed the same record first; a permission or validation error means the server rejected the change.</p>
            <ul>
              {failed.map((f, i) => <li key={i}>{f.op} in <b>{f.table}</b>{f.conflict ? ' — conflict' : ''}: {f.error}</li>)}
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

export { default as MemberPortal } from './memberPortal';

/* ---------------- Family / Children / Check-in ---------------- */
export function Families() {
  return <Crud
    table="families" title="Families / Households" noun="family"
    sortKey="family_name" searchKeys={['family_name','phone','address']}
    fields={[
      {key:'family_name',label:'Family name',required:true},
      {key:'phone',label:'Family phone',type:'tel'},
      {key:'address',label:'Address'},
      {key:'notes',label:'Notes',type:'textarea',full:true},
    ]}
    columns={[
      {label:'Family',key:'family_name'},
      {label:'Phone',key:'phone'},
      {label:'Address',key:'address'},
    ]}
  />;
}

export function Children() {
  const {data}=useData();
  const members=data.members.map(m=>({value:m.id,label:m.name}));
  return <Crud
    table="children" title="Children" noun="child"
    sortKey="name" searchKeys={['name','guardian_name','guardian_phone']}
    filters={[{key:'status',label:'All statuses',options:['Active','Inactive']}]}
    defaults={{status:'Active'}}
    fields={[
      {key:'name',label:'Child name',required:true},
      {key:'dob',label:'Date of birth',type:'date'},
      {key:'gender',label:'Gender',type:'select',options:['Male','Female']},
      {key:'member_id',label:'Linked member/guardian',type:'select',options:members},
      {key:'guardian_name',label:'Guardian name'},
      {key:'guardian_phone',label:'Guardian phone',type:'tel'},
      {key:'pickup_notes',label:'Pickup notes',type:'textarea',full:true},
      {key:'medical_notes',label:'Medical notes',type:'textarea',full:true},
      {key:'status',label:'Status',type:'select',options:['Active','Inactive'],required:true},
    ]}
    columns={[
      {label:'Child',render:c=><><b>{c.name}</b><br/><small>{c.dob||'DOB not recorded'}</small></>},
      {label:'Guardian',render:c=><>{c.guardian_name||'Not recorded'}<br/><small>{c.guardian_phone||''}</small></>},
      {label:'Status',render:c=>badge(c.status)},
    ]}
  />;
}

function GroupCheckIn({ group, title }) {
  const { data, save } = useData();
  const [q,setQ]=useState(''); const [service,setService]=useState('Sunday Service'); const [msg,setMsg]=useState('');
  const isOmega=group==='Omega';
  const members=(data.members||[]).filter(m=>m.status==='Active' && (isOmega ? /omega|youth/i.test(String(m.grp||'')) : !/omega|youth/i.test(String(m.grp||''))));
  const results=q.trim()?members.filter(m=>`${m.name} ${m.phone||''} ${m.member_code||''}`.toLowerCase().includes(q.toLowerCase())).slice(0,30):members.slice(0,30);
  function checkIn(m){const exists=data.attendance.find(a=>a.member_id===m.id&&a.date===today()&&a.service===service&&a.status==='Present');if(exists){setMsg(`${m.name} is already checked in.`);return;}save('attendance',{id:uuid(),date:today(),service,person_name:m.name,member_id:m.id,status:'Present',note:`${group} check-in`});setMsg(`${m.name} checked in successfully.`);setQ('');}
  return <><div className="top"><div><h1>{title}</h1><div className="muted">Fast attendance check-in for {group}.</div></div></div><div className="panel"><div className="toolbar"><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}>{SERVICES.map(s=><option key={s}>{s}</option>)}</select></div><input placeholder="Search name, phone or member ID" value={q} onChange={e=>setQ(e.target.value)}/></div>{msg&&<p className="muted">{msg}</p>}<div className="quicklist">{results.map(m=><button key={m.id} className="quickrow" onClick={()=>checkIn(m)}><span><b>{m.name}</b><br/><small>{m.member_code||m.phone||''}</small></span><span className="badge">Check in</span></button>)}{!results.length&&<div className="empty">No {group.toLowerCase()} members found.</div>}</div></div></>;
}

export function AdultCheckIn(){ return <GroupCheckIn group="Adults" title="Adults Check-in"/>; }
export function OmegaCheckIn(){ return <GroupCheckIn group="Omega" title="Omega (Youth) Check-in"/>; }

export function ChildCheckIn() {
  const {data,save}=useData();
  const [q,setQ]=useState('');
  const [service,setService]=useState('Sunday Service');
  const [selected,setSelected]=useState(null);
  const [msg,setMsg]=useState('');
  const active=(data.children||[]).filter(c=>c.status==='Active');
  const results=q.trim()?active.filter(c=>`${c.name} ${c.guardian_name||''} ${c.guardian_phone||''}`.toLowerCase().includes(q.toLowerCase())).slice(0,12):[];
  const todayChecks=(data.child_checkins||[]).filter(x=>x.date===today());
  const checkedIds=new Set(todayChecks.filter(x=>!x.check_out).map(x=>x.child_id));
  function checkIn(c){
    if(checkedIds.has(c.id)){setMsg(`${c.name} is already checked in.`);return;}
    const code=String(Math.floor(100000+Math.random()*900000));
    save('child_checkins',{id:uuid(),child_id:c.id,date:today(),service,check_in:new Date().toISOString(),pickup_code:code,notes:''});
    setSelected({child:c,code}); setQ(''); setMsg(`${c.name} checked in. Give the guardian pickup code ${code}.`);
  }
  function checkOut(row){
    const code=prompt('Enter the pickup code.');
    if(!code || String(code)!==String(row.pickup_code)){alert('Pickup code does not match.');return;}
    save('child_checkins',{id:row.id,check_out:new Date().toISOString(),pickup_by:row.pickup_by||row.child_name||'Guardian'});
    setMsg('Child checked out successfully.');
  }
  const activeRows=todayChecks.map(r=>({...r,child_name:data.children.find(c=>c.id===r.child_id)?.name||'Unknown'}));
  return <>
    <div className="top"><div><h1>Children Check-in</h1><div className="muted">Fast Sunday check-in and secure pickup.</div></div></div>
    <div className="panel">
      <div className="toolbar"><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}><option>Sunday Service</option><option>Children's Service</option><option>Special Program</option></select></div><div className="fld" style={{flex:1}}><small>Search child, guardian or phone</small><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Type name or phone" /></div></div>
      {msg&&<p className="muted">{msg}</p>}
      {results.length>0&&<div className="quicklist">{results.map(c=><button className="quickrow" key={c.id} onClick={()=>checkIn(c)}><span><b>{c.name}</b><br/><small>{c.guardian_name||'Guardian not recorded'} · {c.guardian_phone||'No phone'}</small></span><span className="badge">Check in</span></button>)}</div>}
      {!q&&<div className="empty">Search for a child to begin.</div>}
    </div>
    <div className="panel"><h2>Today's children</h2><div className="tablewrap"><table><thead><tr><th>Child</th><th>Check-in</th><th>Pickup code</th><th>Status</th><th></th></tr></thead><tbody>{activeRows.map(r=><tr key={r.id}><td><b>{r.child_name}</b></td><td>{r.check_in?new Date(r.check_in).toLocaleTimeString():''}</td><td><b>{r.pickup_code||''}</b></td><td>{r.check_out?'Checked out':'Checked in'}</td><td className="actions">{!r.check_out&&<button className="secondary sm" onClick={()=>checkOut(r)}>Check out</button>}</td></tr>)}{!activeRows.length&&<tr><td colSpan="5" className="empty">No children checked in today.</td></tr>}</tbody></table></div></div>
    {selected&&<div className="panel"><h2>Pickup slip</h2><p><b>{selected.child.name}</b></p><p>Pickup code: <strong style={{fontSize:28,letterSpacing:4}}>{selected.code}</strong></p><button className="secondary" onClick={()=>window.print()}>Print</button></div>}
  </>;
}

export function MemberCheckIn() {
  const {data,save}=useData();
  const [code,setCode]=useState('');
  const [service,setService]=useState('Sunday Service');
  const [msg,setMsg]=useState('');
  const [recent,setRecent]=useState([]);
  const memberMap=useMemo(()=>new Map(data.members.filter(m=>m.member_code).map(m=>[String(m.member_code).toUpperCase(),m])),[data.members]);
  function submit(e){
    e.preventDefault();
    const key=code.trim().toUpperCase();
    const m=memberMap.get(key);
    if(!m){setMsg('Member code not found.');return;}
    const existing=data.attendance.find(a=>a.member_id===m.id && a.date===today() && a.service===service && a.status==='Present');
    if(existing){setMsg(`${m.name} is already marked present.`);setCode('');return;}
    save('attendance',{id:uuid(),date:today(),service,person_name:m.name,member_id:m.id,status:'Present',note:'Member code check-in'});
    setRecent(r=>[{name:m.name,code:m.member_code,time:new Date().toLocaleTimeString()},...r].slice(0,10));
    setMsg(`Welcome, ${m.name}. Attendance recorded.`);setCode('');
  }
  return <>
    <div className="top"><div><h1>Member QR / ID Check-in</h1><div className="muted">Use the member code printed on the church card. A future camera scanner can use the same code.</div></div></div>
    <div className="panel" style={{maxWidth:700}}><form onSubmit={submit}><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}><option>Sunday Service</option><option>Midweek Service</option><option>Prayer Meeting</option><option>Special Program</option></select></div><div className="fld" style={{marginTop:14}}><small>Member code</small><input autoFocus value={code} onChange={e=>setCode(e.target.value)} placeholder="Example: M-1A2B3C4D" autoCapitalize="characters" /></div><button className="primary" style={{marginTop:12}}>Record attendance</button></form>{msg&&<p className="muted">{msg}</p>}</div>
    <div className="panel"><h2>Recent check-ins</h2>{recent.map((r,i)=><div className="listrow" key={i}><b>{r.name}</b><span className="muted"> · {r.code} · {r.time}</span></div>)}{!recent.length&&<p className="muted">No check-ins recorded in this browser session.</p>}</div>
  </>;
}

/* ---------------- Major Modules V11 ---------------- */
export function FinanceCenter() {
  const { data } = useData();
  const { role } = useAuth();
  if (!can(role, 'pledges', 'read')) return <div className="panel"><h2>Finance Center</h2><p className="muted">Finance access is restricted.</p></div>;
  const totalPledged = data.pledges.reduce((a,p)=>a+Number(p.pledged_amount||0),0);
  const totalPaid = data.pledges.reduce((a,p)=>a+Number(p.paid_amount||0),0);
  const balance = totalPledged-totalPaid;
  const activeProjects = [...new Set(data.pledges.map(p=>p.project).filter(Boolean))];
  return <>
    <div className="top"><div><h1>Finance Center</h1><div className="muted">Giving, pledges and project commitments in one place.</div></div></div>
    <div className="cards">
      <div className="card"><div className="label">Total pledged</div><div className="num" style={{fontSize:22}}>{money(totalPledged)}</div></div>
      <div className="card"><div className="label">Paid</div><div className="num" style={{fontSize:22}}>{money(totalPaid)}</div></div>
      <div className="card"><div className="label">Outstanding</div><div className="num" style={{fontSize:22}}>{money(balance)}</div></div>
      <div className="card"><div className="label">Projects</div><div className="num">{activeProjects.length}</div></div>
    </div>
    <Crud table="pledges" title="Pledges and Projects" noun="pledge" sortKey="created_at" sortDir="desc" searchKeys={['member_name','project','reference']}
      filters={[{key:'status',label:'All statuses',options:['Open','Part-paid','Paid','Cancelled']}]} defaults={{status:'Open',pledged_amount:0,paid_amount:0,currency:'GHS'}}
      fields={[
        {key:'member_name',label:'Member / donor',required:true},{key:'project',label:'Project / fund',required:true},{key:'pledged_amount',label:'Pledged amount',type:'number',required:true},{key:'paid_amount',label:'Amount paid',type:'number'},
        {key:'pledge_date',label:'Pledge date',type:'date'},{key:'due_date',label:'Due date',type:'date'},{key:'status',label:'Status',type:'select',options:['Open','Part-paid','Paid','Cancelled'],required:true},{key:'reference',label:'Reference / receipt'},
        {key:'notes',label:'Notes',type:'textarea',full:true}
      ]}
      columns={[{label:'Member',key:'member_name'},{label:'Project',key:'project'},{label:'Pledged',render:p=>money(p.pledged_amount)},{label:'Paid',render:p=>money(p.paid_amount)},{label:'Balance',render:p=>money(Number(p.pledged_amount||0)-Number(p.paid_amount||0))},{label:'Status',render:p=>badge(p.status)}]}
    />
  </>;
}

export function CommunicationCenter() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role)) return <div className="panel"><h2>Communication Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  const active = data.members.filter(m=>m.status==='Active' && m.phone).length;
  const announcements = [...data.announcements].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,8);
  return <>
    <div className="top"><div><h1>Communication Center</h1><div className="muted">Manage church announcements and prepare targeted member communication.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Active members with phone</div><div className="num">{active}</div></div><div className="card"><div className="label">Announcements</div><div className="num">{data.announcements.length}</div></div></div>
    <Crud table="announcements" title="Church Announcements" noun="announcement" sortKey="created_at" sortDir="desc" searchKeys={['title','body','audience']} defaults={{audience:'All Members',status:'Published'}}
      filters={[{key:'status',label:'All statuses',options:['Draft','Published','Archived']},{key:'audience',label:'All audiences',options:['All Members','Youth','Children','Men','Women','Department','House Fellowship']} ]}
      fields={[{key:'title',label:'Title',required:true},{key:'body',label:'Message',type:'textarea',required:true,full:true},{key:'audience',label:'Audience',type:'select',options:['All Members','Youth','Children','Men','Women','Department','House Fellowship']},{key:'publish_date',label:'Publish date',type:'date'},{key:'status',label:'Status',type:'select',options:['Draft','Published','Archived'],required:true},{key:'expires_date',label:'Expires',type:'date'}]}
      columns={[{label:'Title',key:'title'},{label:'Audience',key:'audience'},{label:'Publish',key:'publish_date'},{label:'Status',render:a=>badge(a.status)}]}
    />
    <div className="panel"><h2>Latest announcements</h2>{announcements.length?announcements.map(a=><p key={a.id}><b>{a.title}</b><br/><span className="muted">{a.audience} · {a.status}</span></p>):<div className="empty">No announcements yet.</div>}</div>
  </>;
}

export function PastorDashboard() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','secretary','viewer'].includes(role)) return <div className="panel"><h2>Pastoral Dashboard</h2><p className="muted">This dashboard is restricted to church leadership.</p></div>;
  const openCases=data.pastoral_cases.filter(x=>!['Closed','Resolved'].includes(x.status)).length;
  const openFollow=data.follow_ups.filter(x=>['Open','In Progress'].includes(x.status)).length;
  const prayers=data.prayer_requests.filter(x=>!['Answered','Closed'].includes(x.status)).length;
  const visitors=data.visitors.filter(x=>String(x.visit_date||'').slice(0,7)===today().slice(0,7)).length;
  const active=data.members.filter(x=>x.status==='Active').length;
  const lastDates=[...new Set(data.attendance.map(a=>a.date))].sort().reverse().slice(0,6);
  const trend=lastDates.map(d=>({date:d,present:data.attendance.filter(a=>a.date===d&&a.status==='Present').length}));
  return <>
    <div className="top"><div><h1>Pastoral Dashboard</h1><div className="muted">A leadership view of people, care and engagement.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Active members</div><div className="num">{active}</div></div><div className="card"><div className="label">Open follow-ups</div><div className="num">{openFollow}</div></div><div className="card"><div className="label">Open pastoral cases</div><div className="num">{openCases}</div></div><div className="card"><div className="label">Prayer requests</div><div className="num">{prayers}</div></div><div className="card"><div className="label">Visitors this month</div><div className="num">{visitors}</div></div></div>
    <div className="grid2"><div className="panel"><h2>Recent attendance trend</h2>{trend.length?<div className="tablewrap"><table><thead><tr><th>Date</th><th>Present</th></tr></thead><tbody>{trend.map(x=><tr key={x.date}><td>{x.date}</td><td><b>{x.present}</b></td></tr>)}</tbody></table></div>:<div className="empty">No attendance records.</div>}</div>
    <div className="panel"><h2>Pastoral priorities</h2><p><b>{openCases}</b> pastoral cases require attention.</p><p><b>{openFollow}</b> follow-ups are open or in progress.</p><p><b>{prayers}</b> prayer requests are active.</p><p className="muted sm">Use the Ministry and Follow-up sections to open each record.</p></div></div>
  </>;
}

/* ---------------- V12 Member Giving + Engagement Automation ---------------- */
export function MemberGiving() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','finance','secretary'].includes(role)) return <div className="panel"><h2>Member Giving & Receipts</h2><p className="muted">Finance access is restricted.</p></div>;
  const rows=[...(data.payment_receipts||[])].sort((a,b)=>String(b.paid_at||b.created_at).localeCompare(String(a.paid_at||a.created_at)));
  const paid=rows.filter(r=>r.status==='Paid').reduce((a,r)=>a+Number(r.amount||0),0);
  const pending=rows.filter(r=>r.status==='Pending').reduce((a,r)=>a+Number(r.amount||0),0);
  const issueReceipt=(r)=>{
    const receipt=r.receipt_number||`R-${String(r.id).replace(/-/g,'').slice(0,8).toUpperCase()}`;
    const html=`<html><head><title>Church Receipt ${receipt}</title><style>body{font-family:Arial;padding:35px;max-width:650px;margin:auto}h1{text-align:center}hr{border:0;border-top:1px solid #ddd}.row{display:flex;justify-content:space-between;padding:9px 0}.total{font-size:24px;font-weight:700}</style></head><body><h1>${import.meta.env.VITE_CHURCH_NAME||'Church'}<br><small>Giving Receipt</small></h1><hr><div class="row"><b>Receipt</b><span>${receipt}</span></div><div class="row"><b>Member / donor</b><span>${r.member_name||'Anonymous'}</span></div><div class="row"><b>Fund</b><span>${r.fund||''}</span></div><div class="row"><b>Method</b><span>${r.method||''}${r.provider?' / '+r.provider:''}</span></div><div class="row"><b>Reference</b><span>${r.reference||''}</span></div><hr><div class="row total"><span>Amount</span><span>GH₵ ${Number(r.amount||0).toFixed(2)}</span></div><p>Paid: ${r.paid_at||r.created_at||''}</p><p style="color:#666">Thank you for your contribution.</p><script>window.print()</script></body></html>`;
    const w=window.open('','_blank','width=760,height=800'); if(w){w.document.write(html);w.document.close();}
  };
  return <>
    <div className="top"><div><h1>Member Giving & Receipts</h1><div className="muted">Track digital giving records and print official receipts.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Paid</div><div className="num">{money(paid)}</div></div><div className="card"><div className="label">Pending</div><div className="num">{money(pending)}</div></div><div className="card"><div className="label">Receipts</div><div className="num">{rows.length}</div></div></div>
    <Crud table="payment_receipts" title="Digital Giving Records" noun="receipt" sortKey="paid_at" sortDir="desc" searchKeys={['member_name','reference','receipt_number','fund']} filters={[{key:'status',label:'All statuses',options:['Pending','Paid','Failed','Refunded']},{key:'method',label:'All methods',options:['Mobile Money','Bank','Card','Cash']}]}
      defaults={{amount:0,fund:'Offering',method:'Mobile Money',status:'Paid'}}
      fields={[{key:'member_name',label:'Member / donor',required:true},{key:'amount',label:'Amount (GHS)',type:'number',step:'0.01',gt:0,required:true},{key:'fund',label:'Fund',required:true},{key:'method',label:'Method',type:'select',options:['Mobile Money','Bank','Card','Cash'],required:true},{key:'provider',label:'Provider / bank'},{key:'reference',label:'Transaction reference'},{key:'receipt_number',label:'Receipt number'},{key:'status',label:'Status',type:'select',options:['Pending','Paid','Failed','Refunded'],required:true},{key:'paid_at',label:'Paid at',type:'datetime-local'},{key:'notes',label:'Notes',type:'textarea',full:true}]}
      columns={[{label:'Member',key:'member_name'},{label:'Amount',render:r=>money(r.amount)},{label:'Fund',key:'fund'},{label:'Method',key:'method'},{label:'Reference',key:'reference'},{label:'Status',render:r=>badge(r.status)},{label:'Receipt',render:r=><button className="sm" onClick={()=>issueReceipt(r)}>Print</button>}]}
    />
  </>;
}

export function EngagementAutomation() {
  const { data } = useData();
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role)) return <div className="panel"><h2>Engagement Automation</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  const templates=[...(data.communication_templates||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const queue=[...(data.communication_queue||[])].sort((a,b)=>String(a.scheduled_for||'').localeCompare(String(b.scheduled_for||'')));
  const birthdayCount=data.members.filter(m=>m.dob && String(m.dob).slice(5)===today().slice(5)).length;
  const visitorCount=data.visitors.filter(v=>String(v.visit_date||'').slice(0,7)===today().slice(0,7)).length;
  return <>
    <div className="top"><div><h1>Engagement Automation</h1><div className="muted">Prepare reusable messages and queue member follow-up. Sending requires a connected SMS, WhatsApp or email provider.</div></div></div>
    <div className="cards"><div className="card"><div className="label">Birthdays today</div><div className="num">{birthdayCount}</div></div><div className="card"><div className="label">Visitors this month</div><div className="num">{visitorCount}</div></div><div className="card"><div className="label">Templates</div><div className="num">{templates.length}</div></div><div className="card"><div className="label">Queued messages</div><div className="num">{queue.filter(q=>q.status==='Queued').length}</div></div></div>
    <Crud table="communication_templates" title="Message Templates" noun="template" sortKey="created_at" sortDir="desc" searchKeys={['name','body','audience']} filters={[{key:'channel',label:'All channels',options:['SMS','WhatsApp','Email','In-app']},{key:'audience',label:'All audiences',options:['All Members','Youth','Children','Men','Women','New Visitors','Birthdays']}]} defaults={{channel:'SMS',audience:'All Members',active:true}}
      fields={[{key:'name',label:'Template name',required:true},{key:'channel',label:'Channel',type:'select',options:['SMS','WhatsApp','Email','In-app'],required:true},{key:'audience',label:'Audience',type:'select',options:['All Members','Youth','Children','Men','Women','New Visitors','Birthdays'],required:true},{key:'subject',label:'Subject'},{key:'body',label:'Message',type:'textarea',required:true,full:true},{key:'active',label:'Active',type:'checkbox'}]}
      columns={[{label:'Name',key:'name'},{label:'Channel',key:'channel'},{label:'Audience',key:'audience'},{label:'Active',render:t=>badge(t.active?'Active':'Off')}]}
    />
    <Crud table="communication_queue" title="Message Queue" noun="message" sortKey="scheduled_for" sortDir="asc" searchKeys={['member_name','phone','message','trigger_type']} filters={[{key:'status',label:'All statuses',options:['Queued','Processing','Sent','Delivered','Failed','Cancelled']},{key:'trigger_type',label:'All triggers',options:['Manual','Birthday','New Visitor','Follow-up','Event Reminder']}]} defaults={{channel:'SMS',status:'Queued',trigger_type:'Manual'}}
      fields={[{key:'member_name',label:'Recipient name',required:true},{key:'phone',label:'Phone'},{key:'channel',label:'Channel',type:'select',options:['SMS','WhatsApp','Email','In-app'],required:true},{key:'trigger_type',label:'Trigger',type:'select',options:['Manual','Birthday','New Visitor','Follow-up','Event Reminder'],required:true},{key:'scheduled_for',label:'Scheduled for',type:'datetime-local'},{key:'status',label:'Status',type:'select',options:['Queued','Sent','Failed','Cancelled'],required:true},{key:'message',label:'Message',type:'textarea',required:true,full:true}]}
      columns={[{label:'Recipient',key:'member_name'},{label:'Channel',key:'channel'},{label:'Trigger',key:'trigger_type'},{label:'Scheduled',key:'scheduled_for'},{label:'Status',render:q=>badge(q.status)}]}
    />
  </>;
}


/* ---------------- V13 Finance Reconciliation + Engagement ---------------- */
export function FinanceReconciliation() {
  const { data, save } = useData();
  const { role } = useAuth();
  if (!['admin','finance'].includes(role)) return <div className="panel"><h2>Finance Reconciliation</h2><p className="muted">Finance access is restricted.</p></div>;
  const [date,setDate]=useState(today());
  const [method,setMethod]=useState('All');
  const [note,setNote]=useState('');
  const rows=(data.payment_receipts||[]).filter(r=>String(r.paid_at||r.created_at).slice(0,10)===date && r.status==='Paid' && (method==='All'||r.method===method));
  const giving=(data.giving||[]).filter(r=>String(r.date).slice(0,10)===date);
  const offerings=(data.offering_entries||[]).filter(r=>String(r.date).slice(0,10)===date);
  const digital=rows.reduce((n,r)=>n+Number(r.amount||0),0);
  const manualGiving=giving.reduce((n,r)=>n+Number(r.amount||0),0);
  const manualOffering=offerings.reduce((n,r)=>n+Number(r.amount||0),0);
  const total=digital+manualGiving+manualOffering;
  const existing=(data.finance_reconciliations||[]).find(r=>r.date===date && r.method_filter===method);
  const [counted,setCounted]=useState(existing?.counted_amount ?? '');
  useEffect(()=>setCounted(existing?.counted_amount ?? ''),[existing?.id,existing?.counted_amount,date,method]);
  const difference=Number(counted||0)-total;
  function saveRec(){
    save('finance_reconciliations',{id:existing?.id||uuid(),date,method_filter:method,system_amount:Number(total.toFixed(2)),counted_amount:Number(counted||0),difference:Number(difference.toFixed(2)),notes:note||existing?.notes||'',status:Math.abs(difference)<0.01?'Balanced':'Needs Review'});
    alert(Math.abs(difference)<0.01?'Reconciliation saved as balanced.':'Reconciliation saved for review.');
  }
  return <>
    <div className="top"><div><h1>Finance Reconciliation</h1><div className="muted">Compare recorded income with the amount physically or electronically verified for a selected day.</div></div></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Date</small><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="fld"><small>Payment method</small><select value={method} onChange={e=>setMethod(e.target.value)}><option>All</option><option>Mobile Money</option><option>Bank</option><option>Card</option><option>Cash</option></select></div></div></div>
    <div className="cards"><div className="card"><span className="label">Digital receipts</span><strong>{money(digital)}</strong></div><div className="card"><span className="label">Manual giving</span><strong>{money(manualGiving)}</strong></div><div className="card"><span className="label">Offerings</span><strong>{money(manualOffering)}</strong></div><div className="card"><span className="label">System total</span><strong>{money(total)}</strong></div></div>
    <div className="panel"><h2>Reconcile</h2><div className="formgrid"><div><label>Verified amount (GHS)</label><input type="number" min="0" step="0.01" value={counted} onChange={e=>setCounted(e.target.value)} /></div><div><label>Difference</label><input readOnly value={Number.isFinite(difference)?`GH₵ ${difference.toFixed(2)}`:''} /></div><div className="full"><label>Notes</label><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional reconciliation note" /></div></div><div className="toolbar"><button className="primary" onClick={saveRec}>Save reconciliation</button>{existing&&badge(existing.status)}</div></div>
    <div className="panel"><h2>Recorded transactions</h2><div className="tablewrap"><table><thead><tr><th>Source</th><th>Reference</th><th>Member / donor</th><th>Method</th><th>Amount</th></tr></thead><tbody>
      {rows.map(r=><tr key={r.id}><td>Digital receipt</td><td>{r.reference||r.receipt_number||''}</td><td>{r.member_name||'Anonymous'}</td><td>{r.method}</td><td>{money(r.amount)}</td></tr>)}
      {giving.map(r=><tr key={'g'+r.id}><td>Giving</td><td>{r.reference||''}</td><td>{r.member_name||''}</td><td>{r.method||'Cash'}</td><td>{money(r.amount)}</td></tr>)}
      {offerings.map(r=><tr key={'o'+r.id}><td>Offering</td><td>{r.reference||''}</td><td>{r.person_name||''}</td><td>{r.method||'Cash'}</td><td>{money(r.amount)}</td></tr>)}
      {!rows.length&&!giving.length&&!offerings.length&&<tr><td colSpan="5" className="empty">No recorded transactions for this date.</td></tr>}
    </tbody></table></div></div>
  </>;
}

export function AutomationCenter() {
  const { data, save } = useData();
  const { role } = useAuth();
  if (!['admin','secretary'].includes(role)) return <div className="panel"><h2>Automation Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  const [channel,setChannel]=useState('SMS');
  const [runMsg,setRunMsg]=useState('');
  const templates=(data.communication_templates||[]).filter(t=>t.active);
  const birthdayTemplate=templates.find(t=>t.audience==='Birthdays' && t.channel===channel);
  const visitorTemplate=templates.find(t=>t.audience==='New Visitors' && t.channel===channel);
  const todayKey=today();
  const birthdays=(data.members||[]).filter(m=>m.dob && String(m.dob).slice(5)===todayKey.slice(5) && m.phone);
  const recentVisitors=(data.visitors||[]).filter(v=>String(v.visit_date||'').slice(0,7)===todayKey.slice(0,7) && v.phone);
  const alreadyQueued=new Set((data.communication_queue||[]).filter(q=>q.status!=='Cancelled').map(q=>`${q.trigger_type}:${q.member_id||q.member_name}:${String(q.scheduled_for||'').slice(0,10)}`));
  const enqueue=(m,template,type,body)=>{
    const key=`${type}:${m.id||m.name}:${todayKey}`;
    if(alreadyQueued.has(key)) return false;
    save('communication_queue',{id:uuid(),member_id:m.id||null,member_name:m.name||m.full_name||'',phone:m.phone||'',channel,template_id:template?.id||null,trigger_type:type,scheduled_for:new Date().toISOString(),status:'Queued',message:body});
    return true;
  };
  const personalize=(body,m)=>String(body||'').replaceAll('{{name}}',m.name||m.full_name||'Member').replaceAll('{{church}}',import.meta.env.VITE_CHURCH_NAME||'Church');
  function queueBirthdays(){let n=0;birthdays.forEach(m=>{if(birthdayTemplate&&enqueue(m,birthdayTemplate,'Birthday',personalize(birthdayTemplate.body,m)))n++;});setRunMsg(`${n} birthday message${n===1?'':'s'} queued.`);}
  function queueVisitors(){let n=0;recentVisitors.forEach(v=>{const m={id:null,name:v.name,phone:v.phone};if(visitorTemplate&&enqueue(m,visitorTemplate,'New Visitor',personalize(visitorTemplate.body,m)))n++;});setRunMsg(`${n} visitor follow-up message${n===1?'':'s'} queued.`);}
  return <>
    <div className="top"><div><h1>Automation Center</h1><div className="muted">Prepare birthday and new-visitor messages without sending anything until a provider is connected.</div></div></div>
    <div className="panel"><div className="toolbar"><div className="fld"><small>Channel</small><select value={channel} onChange={e=>setChannel(e.target.value)}><option>SMS</option><option>WhatsApp</option><option>Email</option><option>In-app</option></select></div><button className="primary" onClick={queueBirthdays} disabled={!birthdayTemplate}>Queue today's birthdays</button><button onClick={queueVisitors} disabled={!visitorTemplate}>Queue new visitor follow-up</button></div>{runMsg&&<p className="muted">{runMsg}</p>}<p className="muted sm">Templates use {{name}} and {{church}} placeholders. Queued messages stay in the Communication Queue until a connected provider sends them.</p></div>
    <div className="cards"><div className="card"><span className="label">Birthdays today</span><strong>{birthdays.length}</strong></div><div className="card"><span className="label">Visitors this month</span><strong>{recentVisitors.length}</strong></div><div className="card"><span className="label">Active templates</span><strong>{templates.length}</strong></div><div className="card"><span className="label">Queued</span><strong>{(data.communication_queue||[]).filter(q=>q.status==='Queued').length}</strong></div></div>
    <div className="grid2"><div className="panel"><h2>Today's birthdays</h2>{birthdays.length?birthdays.map(m=><div className="listrow" key={m.id}><b>{m.name}</b><span className="muted"> · {m.phone}</span></div>):<div className="empty">No birthdays with phone numbers today.</div>}</div><div className="panel"><h2>Recent visitors</h2>{recentVisitors.length?recentVisitors.slice(0,20).map(v=><div className="listrow" key={v.id}><b>{v.name}</b><span className="muted"> · {v.visit_date} · {v.phone}</span></div>):<div className="empty">No visitors with phone numbers this month.</div>}</div></div>
  </>;
}


/* ---------------- V14 Advanced Reports + Branches ---------------- */
export function AdvancedReports() {
  const { data } = useData();
  const { role } = useAuth();
  const [period, setPeriod] = useState('12');
  const months = Number(period);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const key = (d) => String(d || '').slice(0, 7);
  const labels = Array.from({ length: months }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const activeMembers = (data.members||[]).filter(m => m.status !== 'Inactive');
  const attendanceByMonth = Object.fromEntries(labels.map(x => [x, {present:0, visitor:0, absent:0, sessions:new Set()}]));
  (data.attendance||[]).forEach(a => {
    const k=key(a.date); if(!attendanceByMonth[k]) return;
    if(a.status==='Present') attendanceByMonth[k].present++;
    else if(a.status==='Visitor') attendanceByMonth[k].visitor++;
    else if(a.status==='Absent') attendanceByMonth[k].absent++;
    attendanceByMonth[k].sessions.add(`${a.date}|${a.service}`);
  });
  const eventByMonth = Object.fromEntries(labels.map(x=>[x,{events:0,registrations:0,attended:0}]));
  (data.events||[]).forEach(e=>{const k=key(e.date);if(eventByMonth[k])eventByMonth[k].events++;});
  (data.event_registrations||[]).forEach(r=>{const ev=(data.events||[]).find(e=>e.id===r.event_id);const k=key(ev?.date);if(eventByMonth[k])eventByMonth[k].registrations++;});
  const monthRows=labels.map(k=>({month:k,...attendanceByMonth[k],...eventByMonth[k],sessions:attendanceByMonth[k].sessions.size}));
  const recentSessions=[...new Set((data.attendance||[]).filter(a=>a.status==='Present').map(a=>`${a.date}|${a.service}`))].sort().reverse().slice(0,8);
  const activeNames=new Set(activeMembers.map(m=>m.name));
  const presentNames=new Set((data.attendance||[]).filter(a=>a.status==='Present' && recentSessions.includes(`${a.date}|${a.service}`)).map(a=>a.person_name));
  const engaged=activeMembers.filter(m=>presentNames.has(m.name)).length;
  const engagementRate=activeMembers.length ? Math.round(engaged/activeMembers.length*100) : 0;
  const followupsOpen=(data.follow_ups||[]).filter(f=>['Open','In Progress'].includes(f.status)).length;
  const prayerOpen=(data.prayer_requests||[]).filter(p=>!['Answered','Closed'].includes(p.status)).length;
  const visitorsMonth=(data.visitors||[]).filter(v=>key(v.visit_date)===key(now.toISOString())).length;
  const showFinance=can(role,'giving','read');
  const financeMonth=labels.map(k=>{
    const giving=(data.giving||[]).filter(g=>key(g.date)===k).reduce((n,g)=>n+Number(g.amount||0),0);
    const offering=(data.offering_entries||[]).filter(g=>key(g.date)===k).reduce((n,g)=>n+Number(g.amount||0),0);
    return {month:k,giving,offering,total:giving+offering};
  });
  const downloadReport=()=>download(`advanced-report-${today()}.json`,JSON.stringify({generatedAt:new Date().toISOString(),periodMonths:months,summary:{activeMembers:activeMembers.length,engagementRate,openFollowUps:followupsOpen,openPrayerRequests:prayerOpen,visitorsThisMonth:visitorsMonth},monthlyAttendance:monthRows,monthlyFinance:showFinance?financeMonth:[]},null,2),'application/json');
  return <>
    <div className="top"><div><h1>Advanced Reports</h1><div className="muted">Leadership overview of attendance, engagement, events and follow-up activity.</div></div><div className="btnrow"><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">24 months</option></select><button className="secondary" onClick={downloadReport}>Export report</button></div></div>
    <div className="cards">
      <div className="card"><span className="label">Active members</span><strong>{activeMembers.length}</strong></div>
      <div className="card"><span className="label">Recent engagement</span><strong>{engagementRate}%</strong><span className="muted sm">present in recent services</span></div>
      <div className="card"><span className="label">Open follow-ups</span><strong>{followupsOpen}</strong></div>
      <div className="card"><span className="label">Open prayer requests</span><strong>{prayerOpen}</strong></div>
      <div className="card"><span className="label">Visitors this month</span><strong>{visitorsMonth}</strong></div>
    </div>
    <div className="panel"><h2>Attendance trend</h2><div className="tablewrap"><table><thead><tr><th>Month</th><th>Present</th><th>Visitors</th><th>Absent</th><th>Recorded services</th></tr></thead><tbody>{monthRows.map(r=><tr key={r.month}><td>{r.month}</td><td>{r.present}</td><td>{r.visitor}</td><td>{r.absent}</td><td>{r.sessions}</td></tr>)}</tbody></table></div></div>
    <div className="grid2">
      <div className="panel"><h2>Event activity</h2><div className="tablewrap"><table><thead><tr><th>Month</th><th>Events</th><th>Registrations</th></tr></thead><tbody>{monthRows.map(r=><tr key={r.month}><td>{r.month}</td><td>{r.events}</td><td>{r.registrations}</td></tr>)}</tbody></table></div></div>
      {showFinance&&<div className="panel"><h2>Finance trend</h2><div className="tablewrap"><table><thead><tr><th>Month</th><th>Giving</th><th>Offering</th><th>Total</th></tr></thead><tbody>{financeMonth.map(r=><tr key={r.month}><td>{r.month}</td><td>{money(r.giving)}</td><td>{money(r.offering)}</td><td><b>{money(r.total)}</b></td></tr>)}</tbody></table></div></div>}
    </div>
    <div className="panel"><h2>Recent service engagement</h2><p className="muted">Active members: {activeMembers.length}. Members appearing as Present in at least one of the last {recentSessions.length} recorded services: {engaged}.</p><div className="tablewrap"><table><thead><tr><th>Member</th><th>Status</th><th>Recent attendance</th></tr></thead><tbody>{activeMembers.filter(m=>recentSessions.length && !presentNames.has(m.name)).slice(0,50).map(m=><tr key={m.id}><td>{m.name}</td><td>{m.status}</td><td className="muted">No Present mark in recent recorded services</td></tr>)}{(!recentSessions.length||!activeMembers.some(m=>!presentNames.has(m.name)))&&<tr><td colSpan="3" className="empty">No engagement gaps to display from the available attendance records.</td></tr>}</tbody></table></div></div>
  </>;
}

export function MobileMoneyPayments() {
  const { data, save } = useData();
  const { role } = useAuth();
  const allowed = ['admin','finance'];
  const [memberId,setMemberId]=useState(''); const [amount,setAmount]=useState(''); const [fund,setFund]=useState('Offering');
  const [phone,setPhone]=useState(''); const [provider,setProvider]=useState('mtn'); const [status,setStatus]=useState('');
  if (!allowed.includes(role)) return <div className="panel"><h2>Mobile Money Payments</h2><p className="muted">Only administrators and finance users have access.</p></div>;
  const members=(data.members||[]).filter(m=>m.status!=='Inactive').sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const requests=[...(data.payment_requests||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,50);
  const createRequest=async()=>{ const m=members.find(x=>x.id===memberId); const n=Number(amount);
    if(!m || !phone.trim() || !n || n<=0){setStatus('Select a member and enter a valid amount and mobile money number.');return;}
    setStatus('Sending payment request to the payment service...');
    const { data: result, error } = await supabase.functions.invoke('paystack-charge',{body:{member_id:m.id,member_name:m.name,email:m.email||'',phone:phone.trim(),provider,amount:n,fund,source:'Finance Center'}});
    if(error || result?.error){setStatus(error?.message || result?.error || 'Payment request failed.');return;}
    setAmount('');setStatus(result?.display_message || 'Payment request sent. Ask the member to approve it on the phone.');
  };
  const counts=['Pending','Processing','Paid','Failed','Expired'].map(x=>[x,requests.filter(r=>r.status===x).length]);
  return <>
    <div className="top"><div><h1>Mobile Money Payments</h1><div className="muted">Create and monitor Ghana Mobile Money payment requests.</div></div></div>
    <div className="cards">{counts.map(([x,n])=><div className="card" key={x}><span className="label">{x}</span><strong>{n}</strong></div>)}</div>
    <div className="panel"><h2>Create payment request</h2><div className="formgrid">
      <div><label>Member</label><select value={memberId} onChange={e=>{setMemberId(e.target.value);const m=members.find(x=>x.id===e.target.value);if(m?.phone)setPhone(m.phone)}}><option value="">Select member</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <div><label>Amount (GHS)</label><input type="number" min="1" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
      <div><label>Fund</label><select value={fund} onChange={e=>setFund(e.target.value)}><option>Tithe</option><option>Offering</option><option>Donation</option><option>Pledge</option><option>Project</option><option>Thanksgiving</option></select></div>
      <div><label>Mobile money provider</label><select value={provider} onChange={e=>setProvider(e.target.value)}><option value="mtn">MTN MoMo</option><option value="vod">Telecel Cash</option><option value="atl">AirtelTigo / ATMoney</option></select></div>
      <div><label>Mobile number</label><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0551234567" /></div>
    </div><div className="toolbar"><button className="primary" onClick={createRequest}>Create payment request</button>{status&&<span className="muted">{status}</span>}</div></div>
    <div className="panel"><h2>Recent payment requests</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Member</th><th>Amount</th><th>Fund</th><th>Provider</th><th>Reference</th><th>Status</th></tr></thead><tbody>{requests.map(r=><tr key={r.id}><td>{String(r.created_at||'').slice(0,16).replace('T',' ')}</td><td>{r.member_name}</td><td>{money(r.amount)}</td><td>{r.fund}</td><td>{r.provider}</td><td>{r.reference||r.provider_reference||''}</td><td>{badge(r.status)}</td></tr>)}{!requests.length&&<tr><td colSpan="7" className="empty">No payment requests yet.</td></tr>}</tbody></table></div></div>
    <div className="panel"><h2>Provider setup</h2><p className="muted">The browser must never contain the Paystack secret key. The supplied Supabase Edge Functions keep that key server-side. Configure <code>PAYSTACK_SECRET_KEY</code>, deploy <code>paystack-charge</code> and <code>paystack-webhook</code>, then set the Paystack webhook URL to the webhook function.</p></div>
  </>;
}


/* ---------------- V17 Delivery Center ---------------- */
export function DeliveryCenter() {
  const { data, syncNow } = useData();
  const { role } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const allowed = ['admin','secretary'].includes(role);
  const queue = [...(data.communication_queue||[])].sort((a,b)=>String(a.scheduled_for||'').localeCompare(String(b.scheduled_for||'')));
  const queued = queue.filter(q=>q.status==='Queued');
  const failed = queue.filter(q=>q.status==='Failed');
  const sent = queue.filter(q=>['Sent','Delivered'].includes(q.status));
  const process = async () => {
    setBusy(true); setMsg('');
    try {
      const { data: result, error } = await supabase.functions.invoke('notification-worker', { body: { limit: 25 } });
      if (error) throw error;
      setMsg(result?.message || `Processed ${result?.processed||0} message(s).`);
      await syncNow();
    } catch (e) { setMsg(e?.message || 'Could not start the notification worker.'); }
    finally { setBusy(false); }
  };
  if (!allowed) return <div className="panel"><h2>Delivery Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;
  return <>
    <div className="top"><div><h1>Delivery Center</h1><div className="muted">Send queued SMS and WhatsApp messages through the secure Supabase Edge Function.</div></div><button className="primary" onClick={process} disabled={busy}>{busy?'Processing…':'Process queue now'}</button></div>
    <div className="cards"><div className="card"><div className="label">Queued</div><div className="num">{queued.length}</div></div><div className="card"><div className="label">Sent</div><div className="num">{sent.length}</div></div><div className="card"><div className="label">Failed</div><div className="num">{failed.length}</div></div><div className="card"><div className="label">Total queue</div><div className="num">{queue.length}</div></div></div>
    {msg&&<div className="panel"><p className="muted">{msg}</p></div>}
    <div className="panel"><h2>Provider setup</h2><p className="muted">SMS uses SMSOnlineGH. WhatsApp uses the Meta WhatsApp Cloud API. Keep all provider credentials in Supabase Edge Function secrets, never in Vite environment variables.</p><div className="tablewrap"><table><thead><tr><th>Channel</th><th>Secrets</th><th>Notes</th></tr></thead><tbody><tr><td>SMS</td><td><code>SMSONLINEGH_API_KEY</code><br/><code>SMSONLINEGH_SENDER_ID</code></td><td>Sender ID must be approved by your SMS provider.</td></tr><tr><td>WhatsApp</td><td><code>WHATSAPP_ACCESS_TOKEN</code><br/><code>WHATSAPP_PHONE_NUMBER_ID</code></td><td>Proactive WhatsApp messages normally require an approved template.</td></tr></tbody></table></div></div>
    <div className="panel"><h2>Recent delivery queue</h2><div className="tablewrap"><table><thead><tr><th>Scheduled</th><th>Recipient</th><th>Channel</th><th>Trigger</th><th>Status</th><th>Error</th></tr></thead><tbody>{queue.slice(0,100).map(q=><tr key={q.id}><td>{String(q.scheduled_for||'').slice(0,16).replace('T',' ')}</td><td>{q.member_name||q.phone||q.email||''}</td><td>{q.channel}</td><td>{q.trigger_type||''}</td><td>{badge(q.status)}</td><td className="muted sm">{q.last_error||q.error_message||''}</td></tr>)}{!queue.length&&<tr><td colSpan="6" className="empty">No messages in the queue.</td></tr>}</tbody></table></div></div>
    <div className="panel"><h2>Automatic processing</h2><p className="muted">After deploying <code>notification-worker</code>, create a Supabase Cron job to call it every minute. Supabase supports invoking Edge Functions from Cron jobs, so scheduled messages can be processed without leaving a browser open.</p><pre>{`supabase functions deploy notification-worker\nsupabase secrets set SMSONLINEGH_API_KEY=... SMSONLINEGH_SENDER_ID=... WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... NOTIFICATION_CRON_SECRET=...`}</pre></div>
  </>;
}

/* ---------------- V15 Church-wide Notification Center ---------------- */
export function NotificationCenter() {
  const { data, save } = useData();
  const { role } = useAuth();
  const allowed = ['admin','secretary'];
  const [channel,setChannel] = useState('In-app');
  const [audience,setAudience] = useState('All Members');
  const [title,setTitle] = useState('');
  const [message,setMessage] = useState('');
  const [schedule,setSchedule] = useState('');
  const [waTemplate,setWaTemplate] = useState('');
  const [waLanguage,setWaLanguage] = useState('en_US');
  const [status,setStatus] = useState('');
  if (!allowed.includes(role)) return <div className="panel"><h2>Notification Center</h2><p className="muted">Only administrators and secretaries have access.</p></div>;

  const members=(data.members||[]).filter(m=>m.status!=='Inactive');
  const targetMembers = useMemo(() => {
    if (audience==='All Members') return members;
    if (audience==='Youth') return members.filter(m=>['Youth','Young Adult'].includes(m.category)||String(m.grp||'').toLowerCase().includes('youth'));
    if (audience==='Men') return members.filter(m=>String(m.gender||'').toLowerCase()==='male');
    if (audience==='Women') return members.filter(m=>String(m.gender||'').toLowerCase()==='female');
    if (audience==='New Visitors') return (data.visitors||[]).filter(v=>v.phone).map(v=>({id:null,name:v.name,phone:v.phone,email:v.email}));
    return members;
  },[audience,members,data.visitors]);

  const queueCampaign = () => {
    if (!title.trim() || !message.trim()) { setStatus('Enter a title and message first.'); return; }
    const campaignId=uuid();
    const now=new Date().toISOString();
    save('notification_campaigns',{id:campaignId,title:title.trim(),message:message.trim(),channel,audience,scheduled_for:schedule?new Date(schedule).toISOString():now,status:'Queued',recipient_count:targetMembers.length});
    targetMembers.forEach(m=>save('communication_queue',{id:uuid(),member_id:m.id||null,member_name:m.name||m.full_name||'',phone:m.phone||'',email:m.email||'',channel,trigger_type:'Campaign',scheduled_for:schedule?new Date(schedule).toISOString():now,status:'Queued',message:message.trim(),campaign_id:campaignId,campaign_title:title.trim(),whatsapp_template_name:channel==='WhatsApp'?waTemplate.trim()||null:null,whatsapp_template_language:channel==='WhatsApp'?waLanguage.trim()||'en_US':'en_US'}));
    setTitle(''); setMessage(''); setSchedule(''); setWaTemplate('');
    setStatus(`${targetMembers.length} recipient message${targetMembers.length===1?'':'s'} queued.`);
  };

  const campaigns=[...(data.notification_campaigns||[])].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,30);
  const queued=(data.communication_queue||[]).filter(q=>q.status==='Queued').length;
  return <>
    <div className="top"><div><h1>Notification Center</h1><div className="muted">Create church-wide or targeted messages and place them in the delivery queue.</div></div></div>
    <div className="cards"><div className="card"><span className="label">Active members</span><strong>{members.length}</strong></div><div className="card"><span className="label">Recipients now</span><strong>{targetMembers.length}</strong></div><div className="card"><span className="label">Queued messages</span><strong>{queued}</strong></div><div className="card"><span className="label">Campaigns</span><strong>{(data.notification_campaigns||[]).length}</strong></div></div>
    <div className="panel"><h2>Create notification</h2><div className="formgrid">
      <div><label>Channel</label><select value={channel} onChange={e=>setChannel(e.target.value)}><option>In-app</option><option>SMS</option><option>WhatsApp</option><option>Email</option></select></div>
      <div><label>Audience</label><select value={audience} onChange={e=>setAudience(e.target.value)}><option>All Members</option><option>Youth</option><option>Men</option><option>Women</option><option>New Visitors</option></select></div>
      <div className="full"><label>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sunday Service Reminder" /></div>
      <div className="full"><label>Message</label><textarea rows="5" value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write the message to be sent..." /></div>
      <div><label>Schedule (optional)</label><input type="datetime-local" value={schedule} onChange={e=>setSchedule(e.target.value)} /></div>{channel==='WhatsApp'&&<><div><label>WhatsApp template name (optional)</label><input value={waTemplate} onChange={e=>setWaTemplate(e.target.value)} placeholder="approved_template_name" /></div><div><label>Template language</label><input value={waLanguage} onChange={e=>setWaLanguage(e.target.value)} placeholder="en_US" /></div></>}
    </div><div className="toolbar"><button className="primary" onClick={queueCampaign}>Queue notification</button><span className="muted">Recipients: {targetMembers.length}</span></div>{status&&<p className="muted">{status}</p>}<p className="muted sm">Messages are queued first. SMS, WhatsApp and email delivery require a connected provider before they are actually sent.</p></div>
    <div className="panel"><h2>Recent campaigns</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Title</th><th>Channel</th><th>Audience</th><th>Recipients</th><th>Status</th></tr></thead><tbody>{campaigns.map(c=><tr key={c.id}><td>{String(c.created_at||'').slice(0,16).replace('T',' ')}</td><td><b>{c.title}</b></td><td>{c.channel}</td><td>{c.audience}</td><td>{c.recipient_count||0}</td><td>{badge(c.status)}</td></tr>)}{!campaigns.length&&<tr><td colSpan="6" className="empty">No campaigns created yet.</td></tr>}</tbody></table></div></div>
  </>;
}
