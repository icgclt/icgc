import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useData } from './data';
import { supabase } from './supabase';
import { upcomingEvents, formatLoginId, escapeHtml as esc } from './utils';

const money = (n) => `GH₵ ${Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const dateText = (v) => v ? new Date(v).toLocaleDateString() : '';
const plainAmount = (n) => Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const FF_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TAB_LABELS = { firstfruit: 'My First Fruit' };

// Month-by-month First Fruit (tithe) for one year, read from the First Fruit register (member_contributions).
function firstFruitYear(rows, year) {
  const byMonth = Array(12).fill(0);
  rows.forEach(r => { if (Number(r.year) === Number(year)) { const m = Number(r.month); if (m >= 1 && m <= 12) byMonth[m-1] += Number(r.amount || 0); } });
  return { byMonth, total: byMonth.reduce((a,b)=>a+b,0), paidCount: byMonth.filter(v => v > 0).length };
}

function printReceipt(r) {
  const w = window.open('', '_blank', 'width=700,height=800');
  if (!w) return;
  w.opener = null; // the receipt window gets no access back to the app
  w.document.write(`<!doctype html><html><head><title>${esc(r.receipt_number || 'Receipt')}</title><style>body{font-family:Arial,sans-serif;padding:40px;max-width:620px;margin:auto}h1{margin-bottom:4px}.muted{color:#666}.line{border-top:1px solid #ddd;margin:20px 0}.row{display:flex;justify-content:space-between;padding:8px 0}</style></head><body><h1>Church Payment Receipt</h1><div class="muted">Receipt: ${esc(r.receipt_number || '')}</div><div class="line"></div><div class="row"><b>Member</b><span>${esc(r.member_name || '')}</span></div><div class="row"><b>Fund</b><span>${esc(r.fund || '')}</span></div><div class="row"><b>Amount</b><span>${esc(money(r.amount))}</span></div><div class="row"><b>Method</b><span>${esc(r.method || '')}</span></div><div class="row"><b>Reference</b><span>${esc(r.reference || '')}</span></div><div class="row"><b>Paid</b><span>${esc(dateText(r.paid_at || r.created_at))}</span></div><div class="line"></div><p class="muted">Thank you for your contribution.</p><script>window.print();</script></body></html>`);
  w.document.close();
}

// Members only see "My Church", so the password form lives here (it is also in Settings for staff).
function MemberPasswordForm() {
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
    <form onSubmit={submit} style={{ maxWidth: 360 }}>
      <label>New password</label><input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      <label>Confirm new password</label><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: 10 }} />
      {msg && <div className={msg.bad ? 'err' : 'muted'} style={{ marginBottom: 10 }}>{msg.t}</div>}
      <button className="primary">Update password</button>
    </form>
  );
}

export default function MemberPortal() {
  const { user, profile } = useAuth();
  const { data, syncNow } = useData();
  const member = useMemo(() => (data.members||[]).find(m => m.user_id === user?.id || (profile?.member_id && m.id === profile.member_id)), [data.members,user?.id,profile?.member_id]);
  const [tab,setTab]=useState('home');
  const currentYear = new Date().getFullYear();
  const [ffYear,setFfYear]=useState(currentYear);
  const [payAmount,setPayAmount]=useState(''); const [payFund,setPayFund]=useState('Offering'); const [payPhone,setPayPhone]=useState(''); const [payProvider,setPayProvider]=useState('mtn'); const [payMsg,setPayMsg]=useState('');
  const [request,setRequest]=useState(''); const [msg,setMsg]=useState(''); const [saving,setSaving]=useState(false); const [profileMsg,setProfileMsg]=useState('');
  const [form,setForm]=useState({phone:'',email:'',address:'',marital_status:'',occupation:'',emergency_contact:''});
  const [prefs,setPrefs]=useState({sms:true,email:true,in_app:true,event_reminders:true,payment_confirmations:true,birthday_messages:true,follow_up_messages:true});
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

  const myAttendance = useMemo(() => member ? (data.attendance||[]).filter(a => a.member_id === member.id || a.person_name === member.name).sort((a,b)=>String(b.date).localeCompare(String(a.date))) : [], [data.attendance,member]);
  const myFirstFruit = useMemo(() => member ? (data.member_contributions||[]).filter(r => r.fund === 'First Fruit' && (r.member_id === member.id || (!r.member_id && r.person_name === member.name))) : [], [data.member_contributions,member]);
  const ffYears = useMemo(() => { const ys = new Set([currentYear]); myFirstFruit.forEach(r => { if (Number(r.year)) ys.add(Number(r.year)); }); return [...ys].sort((a,b)=>b-a); }, [myFirstFruit,currentYear]);
  const ffSelected = useMemo(() => firstFruitYear(myFirstFruit, ffYear), [myFirstFruit,ffYear]);
  const ffThisYear = useMemo(() => firstFruitYear(myFirstFruit, currentYear), [myFirstFruit,currentYear]);
  const myReceipts = useMemo(() => member ? (data.payment_receipts||[]).filter(r=>r.member_id===member.id && r.status==='Paid').sort((a,b)=>String(b.paid_at||b.created_at).localeCompare(String(a.paid_at||a.created_at))) : [], [data.payment_receipts,member]);
  const myRequests = useMemo(() => member ? (data.payment_requests||[]).filter(r=>r.member_id===member.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) : [], [data.payment_requests,member]);
  const myPrayers = useMemo(() => member ? (data.prayer_requests||[]).filter(r=>r.member_id===member.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))) : [], [data.prayer_requests,member]);
  const attendanceSummary = useMemo(() => {
    if (!member) return { daysPresent: 0, attendanceDays: 0, percent: 0 };
    const dates = new Set();
    const presentDates = new Set();
    (data.attendance || []).forEach(a => {
      const d = String(a.date || '').slice(0,10);
      if (!d) return;
      dates.add(d);
      const sameMember = a.member_id === member.id || (!a.member_id && String(a.person_name || '').trim().toLowerCase() === String(member.name || '').trim().toLowerCase());
      if (sameMember && a.status === 'Present') presentDates.add(d);
    });
    const attendanceDays = dates.size;
    const daysPresent = presentDates.size;
    return { daysPresent, attendanceDays, percent: attendanceDays ? Math.round(daysPresent / attendanceDays * 100) : 0 };
  }, [data.attendance, member]);
  const events = upcomingEvents(data.events||[]);
  const todayIso = new Date().toISOString().slice(0,10);
  const announcements = [...(data.announcements||[])].filter(a=>{
    if (a.active === false || a.active === 'false') return false;
    const from = a.publish_from ? String(a.publish_from).slice(0,10) : '';
    const until = a.publish_until ? String(a.publish_until).slice(0,10) : '';
    if (from && from > todayIso) return false;
    if (until && until < todayIso) return false;
    return true;
  }).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,8);

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
    const requester = member?.name || profile?.full_name || user?.email || 'Member';
    const {error}=await supabase.from('prayer_requests').insert({
      id: crypto.randomUUID(),
      date: new Date().toISOString().slice(0,10),
      requester,
      phone: member?.phone || '',
      member_id: member?.id || profile?.member_id || null,
      category: 'General',
      request: request.trim(),
      status: 'New',
      confidential: false,
      notes: '',
    });
    if(error){setMsg(error.message);return;} setRequest(''); setMsg('Prayer request submitted.'); await syncNow();
  }

  const setField=(k,v)=>setForm(x=>({...x,[k]:v}));
  const setPref=(k,v)=>setPrefs(x=>({...x,[k]:v}));
  return <div>
    <div className="top"><div><h1>My Church</h1><p className="muted">Welcome, {member?.name || profile?.full_name || formatLoginId(user?.email)}.</p></div></div>
    {!member && <div className="panel"><h2>Profile linking needed</h2><p className="muted">Your login is not linked to a member record yet. Ask a church administrator to connect your account to your member profile.</p></div>}
    <div className="tabs">{['home','profile','attendance','firstfruit','receipts','pay','events','prayer','notifications','account'].map(x=><button key={x} className={tab===x?'tab active':'tab'} onClick={()=>setTab(x)}>{TAB_LABELS[x] || x[0].toUpperCase()+x.slice(1)}</button>)}</div>
    {tab==='home' && <>
      <div className="cards"><div className="card"><div className="muted">Attendance</div><strong>{attendanceSummary.percent}%</strong><div className="muted sm">{attendanceSummary.daysPresent} of {attendanceSummary.attendanceDays} attendance days</div></div><div className="card"><div className="muted">Attendance records</div><strong>{myAttendance.length}</strong></div><div className="card"><div className="muted">My First Fruit ({currentYear})</div><strong>{money(ffThisYear.total)}</strong><div className="muted sm">{ffThisYear.paidCount} of 12 months paid</div></div><div className="card"><div className="muted">Next event</div><strong style={{fontSize:16}}>{events[0]?.title || 'None scheduled'}</strong><div className="muted sm">{events[0] ? `${events[0].date}${events[0].event_time ? ` · ${events[0].event_time}` : ''}` : ''}</div></div></div>
      <div className="panel"><h2>Upcoming church events</h2>{events.length ? events.slice(0,5).map(e=><div className="listrow" key={e.id}><b>{e.title}</b><div>{e.date}{e.event_time ? ` · ${e.event_time}` : ''}{e.location ? ` · ${e.location}` : ''}</div></div>) : <p className="muted">No upcoming events.</p>}</div><div className="panel"><h2>Quick actions</h2><div className="toolbar"><button className="primary" onClick={()=>setTab('profile')}>Update my profile</button><button className="secondary" onClick={()=>setTab('pay')}>Give by Mobile Money</button><button className="secondary" onClick={()=>setTab('events')}>View upcoming events</button><button className="secondary" onClick={()=>setTab('prayer')}>Send prayer request</button></div></div>
      <div className="panel"><h2>Church announcements</h2>{announcements.length?announcements.map(a=><div className="listrow" key={a.id}><b>{a.title}</b><div className="muted">{a.body}</div></div>):<p className="muted">No announcements.</p>}</div>
    </>}
    {tab==='profile' && <div className="panel"><h2>My profile</h2><p className="muted">Church-controlled information is shown below. You can update your contact and personal details.</p><div className="grid2"><p><b>Name</b><br/>{member?.name||profile?.full_name}</p><p><b>Member ID</b><br/>{member?.member_code||'Pending'}</p><p><b>Gender</b><br/>{member?.gender||'Not recorded'}</p><p><b>Date of birth</b><br/>{member?.dob||'Not recorded'}</p><p><b>Status</b><br/>{member?.status||'Not linked'}</p><p><b>Group</b><br/>{member?.grp||'Not assigned'}</p></div><form onSubmit={saveProfile}><div className="formgrid"><div><label>Phone</label><input value={form.phone} readOnly title="Phone numbers are updated by the church office"/></div><div><label>Email</label><input type="email" value={form.email} onChange={e=>setField('email',e.target.value)}/></div><div><label>Address</label><input value={form.address} onChange={e=>setField('address',e.target.value)}/></div><div><label>Marital status</label><select value={form.marital_status} onChange={e=>setField('marital_status',e.target.value)}><option value="">Not specified</option><option>Single</option><option>Married</option><option>Widowed</option><option>Divorced</option></select></div><div><label>Occupation</label><input value={form.occupation} onChange={e=>setField('occupation',e.target.value)}/></div><div><label>Emergency contact</label><input value={form.emergency_contact} onChange={e=>setField('emergency_contact',e.target.value)}/></div></div><button className="primary" disabled={saving} style={{marginTop:12}}>{saving?'Saving…':'Save my profile'}</button></form>{profileMsg&&<p className="muted">{profileMsg}</p>}</div>}
    {tab==='attendance' && <div><div className="panel"><h2>My attendance</h2><div className="cards"><div className="card"><div className="muted">Attendance percentage</div><strong>{attendanceSummary.percent}%</strong><div className="muted sm">{attendanceSummary.daysPresent} present days out of {attendanceSummary.attendanceDays} recorded attendance days</div></div></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>Service</th><th>Status</th></tr></thead><tbody>{myAttendance.map(a=><tr key={a.id}><td>{a.date}</td><td>{a.service}</td><td>{a.status}</td></tr>)}{!myAttendance.length&&<tr><td colSpan="3" className="empty">No attendance records yet.</td></tr>}</tbody></table></div></div></div>}
    {tab==='firstfruit' && <div className="panel">
      <h2>My First Fruit</h2>
      <div className="ff-top">
        <div className="fld"><small>Year</small><select value={ffYear} onChange={e=>setFfYear(Number(e.target.value))}>{ffYears.map(y=><option key={y} value={y}>{y}</option>)}</select></div>
        <div className="ff-summary"><div className="muted sm">Total paid in {ffYear}</div><strong>{money(ffSelected.total)}</strong><div className="muted sm">{ffSelected.paidCount} of 12 months paid</div></div>
        <div className="ff-legend"><span className="ff-key paid">Paid</span><span className="ff-key unpaid">Not paid</span></div>
      </div>
      <div className="ffgrid">{FF_MONTHS.map((name,i)=>{ const amt = ffSelected.byMonth[i]; const paid = amt > 0; return <div key={name} className={paid?'fftile paid':'fftile unpaid'} aria-label={`${name} ${ffYear}: ${paid ? 'paid GH₵ '+plainAmount(amt) : 'not paid'}`}><div className="ffmonth">{name}</div>{paid ? <><div className="ffcur">GH₵</div><div className="ffamt">{plainAmount(amt)}</div></> : <div className="ffamt ffnone">—</div>}<div className="ffstatus">{paid ? '✓ Paid' : '✗ Not paid'}</div></div>; })}</div>
      {!myFirstFruit.length && <p className="muted" style={{marginTop:12}}>No First Fruit payments have been recorded for you yet.</p>}
    </div>}
    {tab==='receipts' && <div className="panel"><h2>My digital receipts</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Receipt</th><th>Fund</th><th>Amount</th><th>Method</th><th></th></tr></thead><tbody>{myReceipts.map(r=><tr key={r.id}><td>{dateText(r.paid_at||r.created_at)}</td><td>{r.receipt_number||'—'}</td><td>{r.fund}</td><td>{money(r.amount)}</td><td>{r.method||''}</td><td><button className="secondary" onClick={()=>printReceipt(r)}>Print</button></td></tr>)}{!myReceipts.length&&<tr><td colSpan="6" className="empty">No paid receipts available yet.</td></tr>}</tbody></table></div></div>}
    {tab==='pay' && <div><div className="panel"><h2>Give by Mobile Money</h2><p className="muted">Create a secure payment request. You will approve the transaction on your mobile phone.</p><div className="formgrid"><div><label>Amount (GHS)</label><input type="number" min="1" step="0.01" value={payAmount} onChange={e=>setPayAmount(e.target.value)} /></div><div><label>Fund</label><select value={payFund} onChange={e=>setPayFund(e.target.value)}><option>Tithe</option><option>Offering</option><option>Donation</option><option>Pledge</option><option>Project</option><option>Thanksgiving</option></select></div><div><label>Mobile number</label><input type="tel" value={payPhone} onChange={e=>setPayPhone(e.target.value)} placeholder="0551234567" /></div><div><label>Provider</label><select value={payProvider} onChange={e=>setPayProvider(e.target.value)}><option value="mtn">MTN MoMo</option><option value="vod">Telecel Cash</option><option value="atl">AirtelTigo / ATMoney</option></select></div></div><button className="primary" style={{marginTop:10}} onClick={async()=>{const n=Number(payAmount);if(!member||!n||n<=0||!payPhone.trim()){setPayMsg('Enter an amount and mobile number.');return;}const {data:result,error}=await supabase.functions.invoke('paystack-charge',{body:{member_id:member.id,member_name:member.name,email:member.email||user.email,phone:payPhone.trim(),provider:payProvider,amount:n,fund:payFund,source:'Member Portal'}});if(error||result?.error){setPayMsg(error?.message||result?.error||'Payment request failed.');return;}setPayAmount('');setPayMsg(result?.display_message||'Payment request sent. Approve it on your mobile phone.');await syncNow();}} >Request payment</button>{payMsg&&<p className="muted">{payMsg}</p>}</div><div className="panel"><h2>My payment requests</h2><div className="tablewrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Fund</th><th>Provider</th><th>Status</th></tr></thead><tbody>{myRequests.map(r=><tr key={r.id}><td>{dateText(r.created_at)}</td><td>{money(r.amount)}</td><td>{r.fund}</td><td>{r.provider}</td><td>{r.status}</td></tr>)}{!myRequests.length&&<tr><td colSpan="5" className="empty">No payment requests yet.</td></tr>}</tbody></table></div></div></div>}
    {tab==='events' && <div className="panel"><h2>Upcoming events</h2>{events.map(e=><div className="listrow" key={e.id}><b>{e.title}</b><div>{e.date} {e.event_time||''} {e.location?`• ${e.location}`:''}</div><div className="muted">{e.description||''}</div></div>)}{!events.length&&<p className="muted">No upcoming events.</p>}</div>}
    {tab==='prayer' && <div><div className="panel"><h2>Prayer request</h2><form onSubmit={submitPrayer}><textarea rows="5" value={request} onChange={e=>setRequest(e.target.value)} placeholder="Write your prayer request..." style={{width:'100%'}} required/><button className="primary" style={{marginTop:10}}>Submit request</button></form>{msg&&<p className="muted">{msg}</p>}</div><div className="panel"><h2>My prayer requests</h2>{myPrayers.map(p=><div className="listrow" key={p.id}><b>{dateText(p.created_at)} · {p.status||'Open'}</b><div>{p.request}</div></div>)}{!myPrayers.length&&<p className="muted">No prayer requests yet.</p>}</div></div>}
    {tab==='notifications' && <div className="panel"><h2>Notification preferences</h2><p className="muted">Choose which church messages you want to receive.</p>{[['sms','SMS'],['email','Email'],['in_app','In-app notifications'],['event_reminders','Event reminders'],['payment_confirmations','Payment confirmations'],['birthday_messages','Birthday messages'],['follow_up_messages','Follow-up messages']].map(([k,label])=><label key={k} style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={!!prefs[k]} onChange={e=>setPref(k,e.target.checked)} /> {label}</label>)}<button className="primary" onClick={savePrefs}>Save preferences</button>{prefMsg&&<p className="muted">{prefMsg}</p>}</div>}
    {tab==='account' && <div className="panel"><h2>My account</h2><p className="muted">Change the password you use to sign in.</p><MemberPasswordForm /></div>}
  </div>
}
