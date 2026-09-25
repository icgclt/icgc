import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useData } from './data';
import { supabase } from './supabase';

const money = (n) => `GH₵ ${Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const dateText = (v) => v ? new Date(v).toLocaleDateString() : '';

function printReceipt(r) {
  const w = window.open('', '_blank', 'width=700,height=800');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${r.receipt_number || 'Receipt'}</title><style>body{font-family:Arial,sans-serif;padding:40px;max-width:620px;margin:auto}h1{margin-bottom:4px}.muted{color:#666}.line{border-top:1px solid #ddd;margin:20px 0}.row{display:flex;justify-content:space-between;padding:8px 0}</style></head><body><h1>Church Payment Receipt</h1><div class="muted">Receipt: ${r.receipt_number || ''}</div><div class="line"></div><div class="row"><b>Member</b><span>${r.member_name || ''}</span></div><div class="row"><b>Fund</b><span>${r.fund || ''}</span></div><div class="row"><b>Amount</b><span>${money(r.amount)}</span></div><div class="row"><b>Method</b><span>${r.method || ''}</span></div><div class="row"><b>Reference</b><span>${r.reference || ''}</span></div><div class="row"><b>Paid</b><span>${dateText(r.paid_at || r.created_at)}</span></div><div class="line"></div><p class="muted">Thank you for your contribution.</p><script>window.print();</script></body></html>`);
  w.document.close();
}

export default function MemberPortal() {
  const { user, profile } = useAuth();
  const { data, syncNow } = useData();
  const member = useMemo(() => data.members.find(m => m.user_id === user?.id || (profile?.member_id && m.id === profile.member_id)), [data.members,user?.id,profile?.member_id]);
  const [tab,setTab]=useState('home');
  const [payAmount,setPayAmount]=useState(''); const [payFund,setPayFund]=useState('Offering'); const [payPhone,setPayPhone]=useState(''); const [payProvider,setPayProvider]=useState('mtn'); const [payMsg,setPayMsg]=useState('');
  const [request,setRequest]=useState(''); const [msg,setMsg]=useState(''); const [saving,setSaving]=useState(false); const [profileMsg,setProfileMsg]=useState('');
  const [form,setForm]=useState({phone:'',email:'',address:'',marital_status:'',occupation:'',emergency_contact:''});
  const [prefs,setPrefs]=useState({sms:true,whatsapp:true,email:true,in_app:true,event_reminders:true,payment_confirmations:true,birthday_messages:true,follow_up_messages:true});
  const [prefMsg,setPrefMsg]=useState('');

  useEffect(()=>{
    if(!member) return;
    setForm({phone:member.phone||'',email:member.email||user?.email||'',address:member.address||'',marital_status:member.marital_status||'',occupation:member.occupation||'',emergency_contact:member.emergency_contact||''});
    setPayPhone(member.phone||'');
  },[member?.id]);
  useEffect(()=>{
    if(!member) return;
    const p=data.member_notification_preferences?.find(x=>x.member_id===member.id);
    if(p) setPrefs({...prefs,...p});
  },[data.member_notification_preferences,member?.id]);

  const myAttendance = useMemo(() => member ? data.attendance.filter(a => a.member_id === member.id || a.person_name === member.name).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [], [data.attendance,member]);
  const myGiving = useMemo(() => member ? data.giving.filter(g => g.member_id === member.id).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [], [data.giving,member]);
  const myReceipts = useMemo(() => member ? (data.payment_receipts||[]).filter(r=>r.member_id===member.id && r.status==='Paid').sort((a,b)=>String(b.paid_at||b.created_at).localeCompare(String(a.paid_at||a.created_at))) : [], [data.payment_receipts,member]);
  const myRequests = useMemo(() => member ? (data.payment_requests||[]).filter(r=>r.member_id===member.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) : [], [data.payment_requests,member]);
  const myPrayers = useMemo(() => member ? (data.prayer_requests||[]).filter(r=>r.member_id===member.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) : [], [data.prayer_requests,member]);
  const totalGiving = myGiving.reduce((s,g)=>s+Number(g.amount||0),0);
  const events = [...data.events].filter(e=>e.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const announcements = [...(data.announcements||[])].filter(a=>a.active !== false && (!a.publish_from || a.publish_from<=new Date().toISOString().slice(0,10)) && (!a.publish_until || a.publish_until>=new Date().toISOString().slice(0,10))).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,8);

  async function saveProfile(e){
    e.preventDefault(); setSaving(true); setProfileMsg('');
    const {data:updated,error}=await supabase.rpc('update_my_member_profile',{p_phone:form.phone,p_email:form.email,p_address:form.address,p_marital_status:form.marital_status,p_occupation:form.occupation,p_emergency_contact:form.emergency_contact});
    setSaving(false);
    if(error){setProfileMsg(error.message);return;}
    setProfileMsg('Profile updated successfully.');
    await syncNow();
  }
  async function savePrefs(){
    if(!member) return;
    setPrefMsg('Saving…');
    const row={id:data.member_notification_preferences?.find(x=>x.member_id===member.id)?.id||crypto.randomUUID(),member_id:member.id,...prefs};
    const {error}=await supabase.from('member_notification_preferences').upsert(row).select('*').single();
    if(error){setPrefMsg(error.message);return;}
    setPrefMsg('Notification preferences saved.'); await syncNow();
  }
  async function submitPrayer(e){
    e.preventDefault(); if(!request.trim()) return;
    const {error}=await supabase.from('prayer_requests').insert({id:crypto.randomUUID(),person_name:member?.name || profile?.full_name || user.email,member_id:member?.id || null,category:'Member request',request:request.trim(),priority:'Normal',status:'Open',private_notes:''});
    if(error){setMsg(error.message);return;} setRequest(''); setMsg('Prayer request submitted.'); await syncNow();
  }

  const setField=(k,v)=>setForm(x=>({...x,[k]:v}));
  const setPref=(k,v)=>setPrefs(x=>({...x,[k]:v}));
  return <div>
    <div className="top"><div><h1>My Church</h1><p className="muted">Welcome, {member?.name || profile?.full_name || user.email}.</p></div></div>
    {!member && <div className="panel"><h2>Profile linking needed</h2><p className="muted">Your login is not linked to a member record yet. Ask a church administrator to connect your account to your member profile.</p></div>}
    <div className="tabs">{['home','profile','attendance','giving','receipts','pay','events','prayer','notifications'].map(x=><button key={x} className={tab===x?'tab active':'tab'} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</div>
    {tab==='home' && <>
      <div className="cards"><div className="card"><div className="muted">Attendance records</div><strong>{myAttendance.length}</strong></div><div className="card"><div className="muted">My giving</div><strong>{money(totalGiving)}</strong></div><div className="card"><div className="muted">Upcoming events</div><strong>{events.length}</strong></div><div className="card"><div className="muted">Member ID</div><strong>{member?.member_code || 'Pending'}</strong></div></div>
      <div className="panel"><h2>Quick actions</h2><div className="toolbar"><button className="primary" onClick={()=>setTab('profile')}>Update my profile</button><button className="secondary" onClick={()=>setTab('pay')}>Give by Mobile Money</button><button className="secondary" onClick={()=>setTab('events')}>View upcoming events</button><button className="secondary" onClick={()=>setTab('prayer')}>Send prayer request</button></div></div>
      <div className="panel"><h2>Church announcements</h2>{announcements.length?announcements.map(a=><div className="listrow" key={a.id}><b>{a.title}</b><div className="muted">{a.body}</div></div>):<p className="muted">No announcements.</p>}</div>
    </>}
    {tab==='profile' && <div className="panel"><h2>My profile</h2><p className="muted">Church-controlled information is shown below. You can update your contact and personal details.</p><div className="grid2"><p><b>Name</b><br/>{member?.name||profile?.full_name}</p><p><b>Member ID</b><br/>{member?.member_code||'Pending'}</p><p><b>Gender</b><br/>{member?.gender||'Not recorded'}</p><p><b>Date of birth</b><br/>{member?.dob||'Not recorded'}</p><p><b>Status</b><br/>{member?.status||'Not linked'}</p><p><b>Group</b><br/>{member?.grp||'Not assigned'}</p></div><form onSubmit={saveProfile}><div className="formgrid"><div><label>Phone</label><input value={form.phone} onChange={e=>setField('phone',e.target.value)}/></div><div><label>Email</label><input type="email" value={form.email} onChange={e=>setField('email',e.target.value)}/></div><div><label>Address</label><input value={form.address} onChange={e=>setField('address',e.target.value)}/></div><div><label>Marital status</label><select value={form.marital_status} onChange={e=>setField('marital_status',e.target.value)}><option value="">Not specified</option><option>Single</option><option>Married</option><option>Widowed</option><option>Divorced</option></select></div><div><label>Occupation</label><input value={form.occupation} onChange={e=>setField('occupation',e.target.value)}/></div><div><label>Emergency contact</label><input value={form.emergency_contact} onChange={e=>setField('emergency_contact',e.target.value)}/></div></div><button className="primary" disabled={saving} style={{marginTop:12}}>{saving?'Saving…':'Save my profile'}</button></form>{profileMsg&&<p className="muted">{profileMsg}</p>}</div>}
    {tab==='attendance' && <div className="panel"><h2>My attendance</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Status</th></tr></thead><tbody>{myAttendance.map(a=><tr key={a.id}><td>{a.date}</td><td>{a.service}</td><td>{a.status}</td></tr>)}{!myAttendance.length&&<tr><td colSpan="3" className="empty">No attendance records yet.</td></tr>}</tbody></table></div></div>}
    {tab==='giving' && <div className="panel"><h2>My giving</h2><p><b>Total recorded giving: {money(totalGiving)}</b></p><div className="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{myGiving.map(g=><tr key={g.id}><td>{g.date}</td><td>{g.type}</td><td>{money(g.amount)}</td><td>{g.reference||''}</td></tr>)}{!myGiving.length&&<tr><td colSpan="4" className="empty">No giving records linked to your profile.</td></tr>}</tbody></table></div></div>}
    {tab==='receipts' && <div className="panel"><h2>My digital receipts</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Fund</th><th>Amount</th><th>Method</th><th></th></tr></thead><tbody>{myReceipts.map(r=><tr key={r.id}><td>{dateText(r.paid_at||r.created_at)}</td><td>{r.receipt_number||'—'}</td><td>{r.fund}</td><td>{money(r.amount)}</td><td>{r.method||''}</td><td><button className="secondary" onClick={()=>printReceipt(r)}>Print</button></td></tr>)}{!myReceipts.length&&<tr><td colSpan="6" className="empty">No paid receipts available yet.</td></tr>}</tbody></table></div></div>}
    {tab==='pay' && <div><div className="panel"><h2>Give by Mobile Money</h2><p className="muted">Create a secure payment request. You will approve the transaction on your mobile phone.</p><div className="formgrid"><div><label>Amount (GHS)</label><input type="number" min="1" step="0.01" value={payAmount} onChange={e=>setPayAmount(e.target.value)} /></div><div><label>Fund</label><select value={payFund} onChange={e=>setPayFund(e.target.value)}><option>Tithe</option><option>Offering</option><option>Donation</option><option>Pledge</option><option>Project</option><option>Thanksgiving</option></select></div><div><label>Mobile number</label><input type="tel" value={payPhone} onChange={e=>setPayPhone(e.target.value)} placeholder="0551234567" /></div><div><label>Provider</label><select value={payProvider} onChange={e=>setPayProvider(e.target.value)}><option value="mtn">MTN MoMo</option><option value="vod">Telecel Cash</option><option value="atl">AirtelTigo / ATMoney</option></select></div></div><button className="primary" style={{marginTop:10}} onClick={async()=>{const n=Number(payAmount);if(!member||!n||n<=0||!payPhone.trim()){setPayMsg('Enter an amount and mobile number.');return;}const {data:result,error}=await supabase.functions.invoke('paystack-charge',{body:{member_id:member.id,member_name:member.name,email:member.email||user.email,phone:payPhone.trim(),provider:payProvider,amount:n,fund:payFund,source:'Member Portal'}});if(error||result?.error){setPayMsg(error?.message||result?.error||'Payment request failed.');return;}setPayAmount('');setPayMsg(result?.display_message||'Payment request sent. Approve it on your mobile phone.');await syncNow();}} >Request payment</button>{payMsg&&<p className="muted">{payMsg}</p>}</div><div className="panel"><h2>My payment requests</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Fund</th><th>Provider</th><th>Status</th></tr></thead><tbody>{myRequests.map(r=><tr key={r.id}><td>{dateText(r.created_at)}</td><td>{money(r.amount)}</td><td>{r.fund}</td><td>{r.provider}</td><td>{r.status}</td></tr>)}{!myRequests.length&&<tr><td colSpan="5" className="empty">No payment requests yet.</td></tr>}</tbody></table></div></div></div>}
    {tab==='events' && <div className="panel"><h2>Upcoming events</h2>{events.map(e=><div className="listrow" key={e.id}><b>{e.title}</b><div>{e.date} {e.event_time||''} {e.location?`• ${e.location}`:''}</div><div className="muted">{e.description||''}</div></div>)}{!events.length&&<p className="muted">No upcoming events.</p>}</div>}
    {tab==='prayer' && <div><div className="panel"><h2>Prayer request</h2><form onSubmit={submitPrayer}><textarea rows="5" value={request} onChange={e=>setRequest(e.target.value)} placeholder="Write your prayer request..." style={{width:'100%'}} required/><button className="primary" style={{marginTop:10}}>Submit request</button></form>{msg&&<p className="muted">{msg}</p>}</div><div className="panel"><h2>My prayer requests</h2>{myPrayers.map(p=><div className="listrow" key={p.id}><b>{dateText(p.created_at)} · {p.status||'Open'}</b><div>{p.request}</div></div>)}{!myPrayers.length&&<p className="muted">No prayer requests yet.</p>}</div></div>}
    {tab==='notifications' && <div className="panel"><h2>Notification preferences</h2><p className="muted">Choose which church messages you want to receive.</p>{[['sms','SMS'],['whatsapp','WhatsApp'],['email','Email'],['in_app','In-app notifications'],['event_reminders','Event reminders'],['payment_confirmations','Payment confirmations'],['birthday_messages','Birthday messages'],['follow_up_messages','Follow-up messages']].map(([k,label])=><label key={k} style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={!!prefs[k]} onChange={e=>setPref(k,e.target.checked)} /> {label}</label>)}<button className="primary" onClick={savePrefs}>Save preferences</button>{prefMsg&&<p className="muted">{prefMsg}</p>}</div>}
  </div>
}
