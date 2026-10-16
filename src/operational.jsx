import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { useAuth, can } from './auth';
import { today, uuid } from './utils';

const badge = (v) => <span className="badge">{v}</span>;

export function MemberCards() {
  const { data } = useData();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [qr, setQr] = useState('');
  const members = useMemo(() => data.members.filter(m => !['Inactive', 'Left'].includes(m.status) && (!q || String(m.name||'').toLowerCase().includes(q.toLowerCase()) || String(m.member_code||'').toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>String(a.name).localeCompare(String(b.name))), [data.members,q]);
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
  const { data, save, remove } = useData();
  const { role } = useAuth();
  const canWrite = can(role, 'department_members', 'write');
  const canDel = can(role, 'department_members', 'del');
  const [selected, setSelected] = useState('');
  const [q, setQ] = useState('');
  const [memberId, setMemberId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [msg, setMsg] = useState('');
  const departments = [...data.departments].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const members = data.department_members || [];
  const current = departments.find(d=>d.id===selected) || departments[0];
  const rows = current ? members.filter(x=>x.department_id===current.id) : [];
  const active = rows.filter(x=>!['Inactive', 'Left'].includes(x.status)).length;
  const byId = new Map(data.members.map(m=>[m.id,m]));
  const inDept = new Set(rows.map(x=>x.member_id));
  const needle = q.trim().toLowerCase();
  const candidates = data.members
    .filter(m=>!['Inactive','Left'].includes(m.status) && !inDept.has(m.id) && (!needle || `${m.name||''} ${m.member_code||''} ${m.phone||''}`.toLowerCase().includes(needle)))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name))).slice(0,50);
  const addMember = () => {
    if (!current || !memberId) return;
    if (inDept.has(memberId)) { setMsg('That member is already in this department.'); return; }
    save('department_members', { id: uuid(), department_id: current.id, member_id: memberId, role_name: roleName.trim() || null, status: 'Active' });
    setMsg(`${byId.get(memberId)?.name || 'Member'} added to ${current.name}.`);
    setMemberId(''); setRoleName(''); setQ('');
  };
  const toggle = (r) => save('department_members', { ...r, status: r.status === 'Inactive' ? 'Active' : 'Inactive' });
  const drop = (r) => { if (confirm(`Remove ${byId.get(r.member_id)?.name || 'this member'} from ${current.name}?`)) remove('department_members', r.id); };
  return <>
    <div className="top"><div><h1>Department Dashboard</h1><div className="muted">Membership, attendance and leadership overview by department.</div></div><select value={current?.id||''} onChange={e=>{setSelected(e.target.value);setMsg('');}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
    {!current ? <div className="panel empty">Create a department first.</div> : <>
      <div className="cards"><div className="card"><span className="label">Department</span><strong>{current.name}</strong></div><div className="card"><span className="label">Leader</span><strong>{current.leader||'Not assigned'}</strong></div><div className="card"><span className="label">Members</span><strong>{active}</strong></div><div className="card"><span className="label">Attendance this month</span><strong>{data.attendance.filter(a=>a.status==='Present' && String(a.date).startsWith(today().slice(0,7)) && rows.some(x=>x.member_id===a.member_id)).length}</strong></div></div>
      {canWrite && <div className="panel"><h2>Add member to {current.name}</h2>
        <div className="toolbar">
          <input placeholder="Search name, Member ID or phone" value={q} onChange={e=>{setQ(e.target.value);setMemberId('');}} />
          <select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Select member ({candidates.length}{candidates.length===50?'+':''} shown)</option>{candidates.map(m=><option key={m.id} value={m.id}>{m.name}{m.member_code?` (${m.member_code})`:''}</option>)}</select>
          <input placeholder="Role in department (optional)" value={roleName} onChange={e=>setRoleName(e.target.value)} />
          <button className="primary" disabled={!memberId} onClick={addMember}>Add to department</button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>}
      <div className="panel"><h2>Department members</h2><div className="tablewrap"><table><thead><tr><th>Member ID</th><th>Member</th><th>Role</th><th>Status</th>{(canWrite||canDel)&&<th>Actions</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{byId.get(r.member_id)?.member_code||''}</td><td>{byId.get(r.member_id)?.name||r.member_name||'Unknown'}</td><td>{r.role_name||''}</td><td>{badge(r.status||'Active')}</td>{(canWrite||canDel)&&<td className="actions">{canWrite&&<button onClick={()=>toggle(r)}>{r.status==='Inactive'?'Make active':'Make inactive'}</button>} {canDel&&<button className="danger" onClick={()=>drop(r)}>Remove</button>}</td>}</tr>)}{!rows.length&&<tr><td colSpan={(canWrite||canDel)?5:4} className="empty">No members assigned yet.</td></tr>}</tbody></table></div></div>
    </>}
  </>;
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
