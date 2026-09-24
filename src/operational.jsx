import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { useAuth } from './auth';
import { today, uuid } from './utils';

const badge = (v) => <span className="badge">{v}</span>;

export function MemberCards() {
  const { data } = useData();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [qr, setQr] = useState('');
  const members = useMemo(() => data.members.filter(m => m.status !== 'Inactive' && (!q || String(m.name||'').toLowerCase().includes(q.toLowerCase()) || String(m.member_code||'').toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>String(a.name).localeCompare(String(b.name))), [data.members,q]);
  useEffect(() => { if (!selected?.member_code) { setQr(''); return; } const payload = encodeURIComponent(`CHURCH-MEMBER:${selected.member_code}`); setQr(`https://quickchart.io/qr?text=${payload}&size=240`); }, [selected]);
  function printCard() { window.print(); }
  return <>
    <div className="top"><div><h1>Member ID Cards</h1><div className="muted">Generate printable member cards with a unique member code and QR code.</div></div><button className="primary" disabled={!selected} onClick={printCard}>Print card</button></div>
    <div className="grid2">
      <div className="panel"><input placeholder="Search member or member code" value={q} onChange={e=>setQ(e.target.value)} /><div className="cardlist">{members.map(m=><button key={m.id} className={'selectcard '+(selected?.id===m.id?'selected':'')} onClick={()=>setSelected(m)}><b>{m.name}</b><span>{m.member_code || 'No member code'}</span><small>{m.phone||''}</small></button>)}{!members.length&&<div className="empty">No members found.</div>}</div></div>
      <div className="panel print-area"><div className="member-id-card"><div className="church-card-head">{import.meta.env.VITE_CHURCH_NAME || 'Church Management'}</div>{selected ? <><div className="member-card-body"><div className="avatar">{String(selected.name||'?').trim().charAt(0).toUpperCase()}</div><div><h2>{selected.name}</h2><p>{selected.member_code}</p><p>{selected.phone||''}</p></div>{qr&&<img src={qr} alt="Member QR code" />}</div><div className="member-card-foot">Present this card for attendance and church identification.</div></> : <div className="empty">Select a member.</div>}</div></div>
    </div>
  </>;
}

export function DepartmentDashboard() {
  const { data } = useData();
  const [selected, setSelected] = useState('');
  const departments = [...data.departments].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const members = data.department_members || [];
  const current = departments.find(d=>d.id===selected) || departments[0];
  const rows = current ? members.filter(x=>x.department_id===current.id) : [];
  const active = rows.filter(x=>x.status !== 'Inactive').length;
  const names = new Map(data.members.map(m=>[m.id,m.name]));
  return <>
    <div className="top"><div><h1>Department Dashboard</h1><div className="muted">Membership, attendance and leadership overview by department.</div></div><select value={current?.id||''} onChange={e=>setSelected(e.target.value)}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
    {!current ? <div className="panel empty">Create a department first.</div> : <><div className="cards"><div className="card"><span className="label">Department</span><strong>{current.name}</strong></div><div className="card"><span className="label">Leader</span><strong>{current.leader||'Not assigned'}</strong></div><div className="card"><span className="label">Members</span><strong>{active}</strong></div><div className="card"><span className="label">Attendance this month</span><strong>{data.attendance.filter(a=>a.status==='Present' && String(a.date).startsWith(today().slice(0,7)) && rows.some(x=>x.member_id===a.member_id)).length}</strong></div></div><div className="panel"><h2>Department members</h2><div className="tablewrap"><table><thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{names.get(r.member_id)||r.member_name||'Unknown'}</td><td>{r.role_name||''}</td><td>{badge(r.status||'Active')}</td></tr>)}{!rows.length&&<tr><td colSpan="3" className="empty">No members assigned yet.</td></tr>}</tbody></table></div></div></>}
  </>;
}

export function GroupDashboard() {
  const { data } = useData();
  const [selected,setSelected]=useState('');
  const groups=[...data.groups].filter(g=>g.status!=='Inactive').sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const current=groups.find(g=>g.id===selected)||groups[0];
  const rows=current?(data.group_members||[]).filter(x=>x.group_id===current.id):[];
  const names=new Map(data.members.map(m=>[m.id,m.name]));
  const month=today().slice(0,7);
  const attendance=data.group_attendance||[];
  const monthMeetings=attendance.filter(a=>a.group_id===current?.id&&String(a.date).startsWith(month));
  return <>
    <div className="top"><div><h1>House Fellowship Dashboard</h1><div className="muted">Track leaders, members, meetings and attendance.</div></div><select value={current?.id||''} onChange={e=>setSelected(e.target.value)}><option value="">Select group</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
    {!current?<div className="panel empty">Create a House Fellowship first.</div>:<><div className="cards"><div className="card"><span className="label">Leader</span><strong>{current.leader||'Not assigned'}</strong></div><div className="card"><span className="label">Members</span><strong>{rows.length}</strong></div><div className="card"><span className="label">Meetings this month</span><strong>{monthMeetings.length}</strong></div><div className="card"><span className="label">Present this month</span><strong>{monthMeetings.reduce((n,a)=>n+Number(a.present_count||0),0)}</strong></div></div><div className="panel"><div className="top"><h2>Members</h2><button className="secondary" onClick={()=>window.print()}>Print report</button></div><table><thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{names.get(r.member_id)||r.member_name}</td><td>{r.role_name||'Member'}</td><td>{badge(r.status||'Active')}</td></tr>)}{!rows.length&&<tr><td colSpan="3" className="empty">No members assigned.</td></tr>}</tbody></table></div></>}
  </>;
}

export function VolunteerSchedule() {
  const { data, save, remove } = useData();
  const [date,setDate]=useState(today());
  const [service,setService]=useState('Sunday Service');
  const [ministry,setMinistry]=useState('');
  const [person,setPerson]=useState('');
  const [role,setRole]=useState('');
  const rows=(data.volunteer_schedules||[]).filter(x=>x.date===date&&x.service===service).sort((a,b)=>String(a.ministry).localeCompare(String(b.ministry)));
  const volunteers=data.volunteers.filter(v=>v.status!=='Inactive');
  function add(){ if(!person||!ministry)return; const v=volunteers.find(x=>x.id===person); save('volunteer_schedules',{id:uuid(),date,service,ministry,person_id:person,person_name:v?.person_name||person,role_name:role||v?.role_name||''}); setPerson('');setRole(''); }
  return <><div className="top"><div><h1>Volunteer Schedule</h1><div className="muted">Assign ushers, media, choir, protocol and other ministry teams to services.</div></div><button className="secondary" onClick={()=>window.print()}>Print schedule</button></div><div className="panel"><div className="toolbar"><div className="fld"><small>Date</small><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div><div className="fld"><small>Service</small><select value={service} onChange={e=>setService(e.target.value)}><option>Sunday Service</option><option>Midweek Service</option><option>Prayer Meeting</option><option>Special Program</option></select></div><input placeholder="Ministry / department" value={ministry} onChange={e=>setMinistry(e.target.value)}/><select value={person} onChange={e=>setPerson(e.target.value)}><option value="">Select volunteer</option>{volunteers.map(v=><option key={v.id} value={v.id}>{v.person_name} · {v.ministry}</option>)}</select><input placeholder="Assignment / role" value={role} onChange={e=>setRole(e.target.value)}/><button className="primary" onClick={add}>Add</button></div></div><div className="panel"><table><thead><tr><th>Ministry</th><th>Person</th><th>Role</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.ministry}</td><td><b>{r.person_name}</b></td><td>{r.role_name}</td><td className="actions"><button className="danger sm" onClick={()=>remove('volunteer_schedules',r.id)}>Remove</button></td></tr>)}{!rows.length&&<tr><td colSpan="4" className="empty">No assignments for this service.</td></tr>}</tbody></table></div></>;
}

export function EventRegistration() {
  const {data,save}=useData();
  const [eventId,setEventId]=useState(''); const [memberId,setMemberId]=useState(''); const [q,setQ]=useState('');
  const events=data.events.filter(e=>e.date>=today()).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const members=data.members.filter(m=>m.status!=='Inactive'&&(!q||String(m.name).toLowerCase().includes(q.toLowerCase())||String(m.phone||'').includes(q)));
  const rows=(data.event_registrations||[]).filter(r=>r.event_id===eventId);
  function add(){if(!eventId||!memberId)return; if(rows.some(r=>r.member_id===memberId))return alert('Member is already registered.'); const m=data.members.find(x=>x.id===memberId);save('event_registrations',{id:uuid(),event_id:eventId,member_id:memberId,member_name:m?.name||'',registered_at:new Date().toISOString(),status:'Registered'});setMemberId('');}
  return <><div className="top"><div><h1>Event Registration</h1><div className="muted">Register members and track event participation.</div></div></div><div className="panel"><div className="toolbar"><select value={eventId} onChange={e=>setEventId(e.target.value)}><option value="">Select event</option>{events.map(e=><option key={e.id} value={e.id}>{e.date} · {e.title}</option>)}</select><input placeholder="Search member" value={q} onChange={e=>setQ(e.target.value)}/><select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Select member</option>{members.map(m=><option key={m.id} value={m.id}>{m.name} · {m.phone||'No phone'}</option>)}</select><button className="primary" onClick={add}>Register</button></div></div><div className="panel"><h2>Registered: {rows.length}</h2><table><thead><tr><th>Member</th><th>Registered</th><th>Status</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.member_name}</td><td>{r.registered_at?new Date(r.registered_at).toLocaleString():''}</td><td>{badge(r.status||'Registered')}</td></tr>)}{!rows.length&&<tr><td colSpan="3" className="empty">No registrations.</td></tr>}</tbody></table></div></>;
}
