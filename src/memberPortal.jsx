import { useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useData } from './data';

const money = (n) => `GH₵ ${Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export default function MemberPortal() {
  const { user, profile } = useAuth();
  const { data, save } = useData();
  const member = useMemo(() => data.members.find(m => m.user_id === user?.id || (profile?.member_id && m.id === profile.member_id)), [data.members,user?.id,profile?.member_id]);
  const [tab,setTab]=useState('home');
  const [request,setRequest]=useState('');
  const [msg,setMsg]=useState('');
  const myAttendance = useMemo(() => member ? data.attendance.filter(a => a.member_id === member.id || a.person_name === member.name).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [], [data.attendance,member]);
  const myGiving = useMemo(() => member ? data.giving.filter(g => g.member_id === member.id).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [], [data.giving,member]);
  const totalGiving = myGiving.reduce((s,g)=>s+Number(g.amount||0),0);
  const events = [...data.events].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,8);
  const announcements = [...(data.announcements||[])].filter(a=>a.active !== false).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,5);
  async function submitPrayer(e){
    e.preventDefault(); if(!request.trim()) return;
    await save('prayer_requests',{id:crypto.randomUUID(), person_name:member?.name || profile?.full_name || user.email, member_id:member?.id || null, category:'Member request', request:request.trim(), priority:'Normal', status:'Open', private_notes:''});
    setRequest(''); setMsg('Prayer request submitted.');
  }
  return <div>
    <div className="top"><div><h1>My Church</h1><p className="muted">Welcome, {member?.name || profile?.full_name || user.email}.</p></div></div>
    {!member && <div className="panel"><h2>Profile linking needed</h2><p className="muted">Your login is not linked to a member record yet. Ask a church administrator to connect your account to your member profile.</p></div>}
    <div className="tabs">
      {['home','profile','attendance','giving','events','prayer'].map(x=><button key={x} className={tab===x?'tab active':'tab'} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}
    </div>
    {tab==='home' && <>
      <div className="cards">
        <div className="card"><div className="muted">Attendance records</div><strong>{myAttendance.length}</strong></div>
        <div className="card"><div className="muted">My giving</div><strong>{money(totalGiving)}</strong></div>
        <div className="card"><div className="muted">Upcoming events</div><strong>{events.length}</strong></div>
        <div className="card"><div className="muted">Member ID</div><strong>{member?.member_code || 'Pending'}</strong></div>
      </div>
      <div className="panel"><h2>Church announcements</h2>{announcements.length?announcements.map(a=><div className="listrow" key={a.id}><b>{a.title}</b><div className="muted">{a.body}</div></div>):<p className="muted">No announcements.</p>}</div>
    </>}
    {tab==='profile' && <div className="panel"><h2>My profile</h2><div className="grid2"><p><b>Name</b><br/>{member?.name||profile?.full_name}</p><p><b>Phone</b><br/>{member?.phone||'Not recorded'}</p><p><b>Email</b><br/>{member?.email||user.email}</p><p><b>Group</b><br/>{member?.grp||'Not assigned'}</p><p><b>Status</b><br/>{member?.status||'Not linked'}</p><p><b>Member ID</b><br/>{member?.member_code||'Pending'}</p></div></div>}
    {tab==='attendance' && <div className="panel"><h2>My attendance</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Status</th></tr></thead><tbody>{myAttendance.map(a=><tr key={a.id}><td>{a.date}</td><td>{a.service}</td><td>{a.status}</td></tr>)}{!myAttendance.length&&<tr><td colSpan="3" className="empty">No attendance records yet.</td></tr>}</tbody></table></div></div>}
    {tab==='giving' && <div className="panel"><h2>My giving</h2><p><b>Total recorded giving: {money(totalGiving)}</b></p><div className="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{myGiving.map(g=><tr key={g.id}><td>{g.date}</td><td>{g.type}</td><td>{money(g.amount)}</td><td>{g.reference||''}</td></tr>)}{!myGiving.length&&<tr><td colSpan="4" className="empty">No giving records linked to your profile.</td></tr>}</tbody></table></div></div>}
    {tab==='events' && <div className="panel"><h2>Upcoming events</h2>{events.map(e=><div className="listrow" key={e.id}><b>{e.title}</b><div>{e.date} {e.event_time||''} {e.location?`• ${e.location}`:''}</div><div className="muted">{e.description||''}</div></div>)}{!events.length&&<p className="muted">No upcoming events.</p>}</div>}
    {tab==='prayer' && <div className="panel"><h2>Prayer request</h2><form onSubmit={submitPrayer}><textarea rows="5" value={request} onChange={e=>setRequest(e.target.value)} placeholder="Write your prayer request..." style={{width:'100%'}} required/><button className="primary" style={{marginTop:10}}>Submit request</button></form>{msg&&<p className="muted">{msg}</p>}</div>}
  </div>
}
