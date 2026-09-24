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
  const [active,setActive]=useState(null),[remaining,setRemaining]=useState(0),[running,setRunning]=useState(false),[overtime,setOvertime]=useState(false),[projector,setProjector]=useState(false);
  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items));}catch{}},[items]);
  useEffect(()=>{if(!running)return;const t=setInterval(()=>setRemaining(v=>{if(v<=1){setRunning(false);setOvertime(true);return 0;}return v-1;}),1000);return()=>clearInterval(t);},[running]);
  const start=i=>{setActive(i);setRemaining(Math.max(1,Number(items[i].minutes)||1)*60);setOvertime(false);setRunning(true);};
  const reset=()=>{if(active===null)return;setRemaining(Math.max(1,Number(items[active].minutes)||1)*60);setOvertime(false);setRunning(false);};
  const next=()=>{if(active!==null&&active<items.length-1)start(active+1);};
  const add=()=>setItems(x=>[...x,{id:uuid(),person:'New person',role:'Programme item',minutes:5}]);
  const update=(id,k,v)=>setItems(x=>x.map(r=>r.id===id?{...r,[k]:k==='minutes'?Math.max(1,Number(v)||1):v}:r));
  const remove=id=>setItems(x=>x.filter(r=>r.id!==id));
  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  const full=async()=>{try{await document.documentElement.requestFullscreen?.();}catch{}setProjector(true);};
  if(projector)return <div className="timer-projector" onClick={()=>setProjector(false)}><div className="timer-projector-title">{active!==null?items[active].person:'Service Timer'}</div><div className={'timer-projector-clock '+(overtime?'overtime':'')}>{overtime?'TIME UP':fmt(remaining)}</div><div className="timer-projector-role">{active!==null?`${items[active].role} · ${items[active].minutes} minutes`:'Select a programme item to begin'}</div><div className="timer-projector-help">Click to return to controls</div></div>;
  return <><div className="top"><div><h1>Service Countdown Timer</h1><div className="muted">Set a duration for each person or programme item. Projector Mode shows the countdown in large text.</div></div><button className="primary" onClick={full}>Projector Mode</button></div><div className="panel"><div className="toolbar"><button onClick={add}>+ Add programme item</button><button onClick={()=>setItems(defaults.map(x=>({...x,id:uuid()})))}>Restore sample</button></div></div><div className="panel"><div className="tablewrap"><table><thead><tr><th>#</th><th>Person / item</th><th>Role</th><th>Minutes</th><th></th></tr></thead><tbody>{items.map((r,i)=><tr key={r.id}><td>{i+1}</td><td><input value={r.person} onChange={e=>update(r.id,'person',e.target.value)}/></td><td><input value={r.role} onChange={e=>update(r.id,'role',e.target.value)}/></td><td><input type="number" min="1" value={r.minutes} onChange={e=>update(r.id,'minutes',e.target.value)} style={{width:90}}/></td><td className="actions"><button className="primary" onClick={()=>start(i)}>Start</button><button className="danger" onClick={()=>remove(r.id)}>Remove</button></td></tr>)}</tbody></table></div></div><div className="panel timer-control"><div className="timer-current"><div className="label">Current item</div><h2>{active!==null?items[active].person:'No item selected'}</h2><div className={'timer-clock '+(overtime?'overtime':'')}>{overtime?'TIME UP':fmt(remaining)}</div><div className="toolbar"><button onClick={()=>setRunning(x=>!x)} disabled={active===null}>{running?'Pause':'Resume'}</button><button onClick={reset} disabled={active===null}>Reset</button><button className="primary" onClick={next} disabled={active===null||active>=items.length-1}>Next</button><button onClick={full}>Projector Mode</button></div></div></div></>;
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

export function WelfareDues() {
  const { data } = useData();
  const roster = [...data.welfare_members].filter((m) => m.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name));
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

  const existing = useMemo(() => {
    const map = new Map();
    data.attendance_headcount.forEach((r) => { if (r.date === date && r.service === service) map.set(r.category, r); });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.attendance_headcount, date, service]);

  useEffect(() => { setEdits({}); }, [date, service]);

  const valueFor = (cat) => (cat in edits ? edits[cat] : String(existing.get(cat)?.count ?? ''));
  const total = HEADCOUNT_CATEGORIES.reduce((s, c) => s + (Number(valueFor(c)) || 0), 0);

  const saveAll = () => {
    let n = 0;
    HEADCOUNT_CATEGORIES.forEach((cat) => {
      if (!(cat in edits)) return;
      const count = Number(edits[cat]) || 0;
      const rec = existing.get(cat);
      save('attendance_headcount', { id: rec ? rec.id : uuid(), date, service, category: cat, count });
      n++;
    });
    setEdits({});
    alert(n ? `Saved headcount for ${n} categor${n === 1 ? 'y' : 'ies'}. Total: ${total}.` : 'No changes to save.');
  };

  const history = [...new Set(data.attendance_headcount.map((r) => r.date + '|' + r.service))]
    .sort().reverse().slice(0, 10)
    .map((k) => {
      const [d, s] = k.split('|');
      const rows = data.attendance_headcount.filter((r) => r.date === d && r.service === s);
      const t = rows.reduce((sum, r) => sum + r.count, 0);
      return { date: d, service: s, total: t };
    });

  return (
    <>
      <div className="top">
        <h1>Headcount Attendance</h1>
        <button className="primary" onClick={saveAll}>Save headcount</button>
      </div>
      <div className="panel">
        <div className="toolbar">
          <div className="fld"><small>Date</small><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="fld"><small>Service</small>
            <select value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
        </div>
        <div className="grid2">
          {HEADCOUNT_CATEGORIES.map((cat) => (
            <div className="fld" key={cat}>
              <small>{cat}</small>
              <input type="number" min="0" value={valueFor(cat)} onChange={(e) => setEdits((ed) => ({ ...ed, [cat]: e.target.value }))} />
            </div>
          ))}
        </div>
        <p className="muted sm" style={{ marginTop: 12 }}>Total for this service: <b>{total}</b></p>
      </div>
      <div className="panel">
        <h2>Recent tallies</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Service</th><th>Total</th></tr></thead>
          <tbody>
            {history.map((r) => <tr key={r.date + r.service}><td>{r.date}</td><td>{r.service}</td><td>{r.total}</td></tr>)}
            {!history.length && <tr><td colSpan="3" className="empty">No headcounts recorded yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
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
  const [dialog, setDialog] = useState(null); // { mode, target }

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

  return (
    <>
      <div className="top">
        <h1>Users</h1>
        <div className="btnrow">
          <button className="secondary" onClick={load}>Refresh</button>
          <button className="primary" onClick={() => setDialog({ mode: 'create' })}>+ Create user</button>
        </div>
      </div>
      <div className="panel">
        <p className="muted">
          Create accounts here and choose each person's role, or approve people who signed up themselves (they show as <b>pending</b>).
          <br /><b>admin</b>: everything · <b>finance</b>: giving + read others · <b>secretary</b>: members, attendance, departments, events · <b>viewer</b>: read-only (no giving).
        </p>
        {msg && <div className="err">{msg}</div>}
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
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
                <td className="actions">
                  <button className="secondary" onClick={() => setDialog({ mode: 'reset', target: p })}>Reset password</button>
                  {p.id !== user.id && <button className="danger" onClick={() => remove(p)}>Delete</button>}
                </td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan="5" className="empty">No users.</td></tr>}
            {!rows && <tr><td colSpan="5" className="empty">Loading…</td></tr>}
          </tbody>
        </table></div>
      </div>
      {dialog && <UserDialog {...dialog} onClose={() => setDialog(null)} onDone={load} />}
    </>
  );
}


/* ---------------- Ministry operations ---------------- */
export function Visitors() {
  return <Crud table="visitors" title="Visitors" noun="visitor" sortKey="visit_date" sortDir="desc"
    searchKeys={['name','phone','invited_by','assigned_to']}
    filters={[{ key:'follow_up_status', label:'All follow-up statuses', options:['New','Contacted','Visited','Connected','Closed'] }]}
    defaults={{ visit_date: today(), follow_up_status:'New' }}
    fields={[
      {key:'visit_date',label:'Visit date',type:'date',required:true},{key:'name',label:'Name',required:true},{key:'phone',label:'Phone',type:'tel'},
      {key:'gender',label:'Gender',type:'select',options:['Male','Female']},{key:'invited_by',label:'Invited by'},{key:'address',label:'Address'},
      {key:'prayer_request',label:'Prayer request',type:'textarea',full:true},{key:'follow_up_status',label:'Follow-up status',type:'select',options:['New','Contacted','Visited','Connected','Closed'],required:true},
      {key:'assigned_to',label:'Follow-up officer'},{key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Date',key:'visit_date'},{label:'Visitor',render:r=><><b>{r.name}</b><br/><small>{r.phone||'No phone'}</small></>},{label:'Invited by',key:'invited_by'},{label:'Follow-up',render:r=>badge(r.follow_up_status)},{label:'Officer',key:'assigned_to'}]}/>
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

export function Volunteers() {
  return <Crud table="volunteers" title="Volunteers" noun="volunteer" sortKey="person_name" searchKeys={['person_name','ministry','role_name','phone']}
    filters={[{key:'status',label:'All statuses',options:['Active','Inactive']}]}
    defaults={{status:'Active'}}
    fields={[
      {key:'person_name',label:'Person',required:true},{key:'ministry',label:'Ministry / department',required:true},{key:'role_name',label:'Role'},
      {key:'phone',label:'Phone',type:'tel'},{key:'availability',label:'Availability'},{key:'status',label:'Status',type:'select',options:['Active','Inactive'],required:true},
      {key:'notes',label:'Notes',type:'textarea',full:true}
    ]}
    columns={[{label:'Person',key:'person_name'},{label:'Ministry',key:'ministry'},{label:'Role',key:'role_name'},{label:'Phone',key:'phone'},{label:'Status',render:r=>badge(r.status)}]}/>
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
  const families=(data.families||[]).map(f=>({value:f.id,label:f.family_name}));
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
      {key:'family_id',label:'Family',type:'select',options:families},
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
      {label:'Family',render:c=>families.find(f=>f.value===c.family_id)?.label||'Not assigned'},
      {label:'Status',render:c=>badge(c.status)},
    ]}
  />;
}

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
