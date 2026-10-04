import { useEffect, useMemo, useState } from 'react';
import { configured, supabase } from './supabase';
import { AuthProvider, useAuth, can, ROLES } from './auth';
import { DataProvider, useData } from './data';
import {
  Dashboard, Members, Attendance, AbsenteeList, HeadcountAttendance, Offerings, EventAttendance, ServiceTimer, ServiceTimerLive,
  FirstFruit, Departments, Events, Users, Settings, SendSMS,
  WelfareDues, WelfareFund, Visitors, Groups, FollowUps, PrayerRequests, ServicePlans, PastoralCare, AuditLog, MemberPortal, ABCClass, ChildrenQuickAttendance, ChildCheckIn, AdultCheckIn, OmegaCheckIn, CommunicationCenter, PastorDashboard, MemberGiving, EngagementAutomation, FinanceReconciliation, AdvancedReports, NotificationCenter, MobileMoneyPayments, DeliveryCenter, MemberLookup, FinanceCenter, AutomationCenter,
} from './pages';
import { DepartmentDashboard } from './operational';

const CHURCH = import.meta.env.VITE_CHURCH_NAME || 'Church Management';

export default function App() {
  if (!configured) return <SetupHelp />;
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { loading, user, profile, role, recovery } = useAuth();
  if (loading) return <div className="login"><div className="loginbox"><h1>{CHURCH}</h1><p className="muted">Loading…</p></div></div>;
  if (!user) return <Login />;
  const mustChange = user?.app_metadata?.must_change_password === true; // app_metadata can only be written by the server
  if (recovery || mustChange) return <SetNewPassword forced={mustChange} />;
  if (!profile || role === 'pending') return <Pending />;
  return (
    <DataProvider key={user.id} uid={user.id} role={role}>
      <Shell />
    </DataProvider>
  );
}

function SetupHelp() {
  return (
    <div className="login">
      <div className="loginbox">
        <h1>Almost there</h1>
        <p>This app is not connected to Supabase yet. Create a file named <code>.env</code> next to <code>package.json</code>:</p>
        <pre>{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_CHURCH_NAME=Your Church`}</pre>
        <p className="muted">Then restart <code>npm run dev</code> (or rebuild). See README.md for the full steps.</p>
      </div>
    </div>
  );
}

function Login() {
  const { signIn, signUp, sendResetEmail } = useAuth();
  const [mode, setMode] = useState('in');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error, offline } = await signIn(f.email.trim(), f.password);
        if (error) {
          setMsg(error.message || 'Sign-in failed.');
        } else if (offline) {
          setMsg('Signed in offline. Your saved device data will continue to work and will sync when the connection returns.');
        }
      } else if (mode === 'forgot') {
        const { error } = await sendResetEmail(f.email.trim());
        setMsg(error ? error.message : 'If that email has an account, a reset link has been sent. Open it on this device.');
      } else {
        if (f.password.length < 6) { setMsg('Password must be at least 6 characters.'); return; }
        const { data, error } = await signUp(f.email.trim(), f.password, f.name.trim());
        if (error) setMsg(error.message);
        else if (!data.session) { setMsg('Account created. Check your email to confirm it, then sign in.'); setMode('in'); }
      }
    } catch {
      setMsg('Could not reach the server. Check your internet connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="loginbox" onSubmit={submit}>
        <div className="login-brand"><img src="/icgc-logo.png" alt="I.C.G.C logo" /><h1>{CHURCH}</h1></div>
        <p className="muted">{mode === 'in' ? 'Members sign in with their phone number and system-generated password. No SMS or WhatsApp is required.' : mode === 'forgot' ? 'Enter your email and we will send you a link to reset your password. Member phone-password resets are handled by the church office.' : 'Create your account. An administrator must approve it before you can see any data.'}</p>
        {mode === 'up' && <><label>Full name</label><input value={f.name} onChange={set('name')} required /></>}
        <label>{mode === 'forgot' ? 'Email address' : 'Phone number or email'}</label><input type="text" value={f.email} onChange={set('email')} required autoComplete="username" placeholder={mode === 'forgot' ? 'name@example.com' : '0241234567 or name@example.com'} />
        {mode !== 'forgot' && <><label>Password</label><input type="password" value={f.password} onChange={set('password')} required autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></>}
        {msg && <div className="err" style={{ marginBottom: 12 }}>{msg}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account'}</button>
        {mode === 'in' && <p style={{ textAlign: 'center', marginBottom: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); setMsg(''); setMode('forgot'); }}>Forgot password?</a></p>}
        <p style={{ textAlign: 'center', marginBottom: 0 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setMsg(''); setMode(mode === 'in' ? 'up' : 'in'); }}>
            {mode === 'in' ? 'Need an account? Sign up' : 'Back to sign in'}
          </a>
        </p>
      </form>
    </div>
  );
}

function SetNewPassword({ forced = false }) {
  const { updatePassword, signOut } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (p1.length < 6) return setMsg('Password must be at least 6 characters.');
    if (p1 !== p2) return setMsg('The two passwords do not match.');
    setBusy(true);
    const { error } = await updatePassword(p1);
    setBusy(false);
    if (error) setMsg(error.message);
  }
  return (
    <div className="login">
      <form className="loginbox" onSubmit={submit}>
        <h1>{forced ? 'Change your temporary password' : 'Set a new password'}</h1>
        {forced && <p className="muted">This is your first login. For your security, change the temporary password before continuing.</p>}
        <label>New password</label><input type="password" value={p1} onChange={(e) => setP1(e.target.value)} required autoComplete="new-password" />
        <label>Confirm new password</label><input type="password" value={p2} onChange={(e) => setP2(e.target.value)} required autoComplete="new-password" />
        {msg && <div className="err" style={{ marginBottom: 12 }}>{msg}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Save password'}</button>
        <div style={{ height: 10 }} />
        <button type="button" className="secondary" onClick={signOut}>Cancel</button>
      </form>
    </div>
  );
}

function Pending() {
  const { signOut, refreshProfile, user, profile } = useAuth();
  return (
    <div className="login">
      <div className="loginbox">
        <h1>Waiting for approval</h1>
        <p>{profile ? <>Your account (<b>{user.email}</b>) has been created, but an administrator has not given it access yet.</> : <>Your account exists but has no profile yet. Ask the administrator to check the database setup.</>}</p>
        <button className="primary" onClick={refreshProfile}>Check again</button>
        <div style={{ height: 10 }} />
        <button className="secondary" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

// A plain entry is [id, label, Component, permissionKey].
// A group is { group, label, items: [...entries] }.
const NAV = [
  ['dashboard', '📊 Dashboard', Dashboard, 'dashboard.view'],
  ['memberportal', '🙋 My Church', MemberPortal, null],
  { group: 'members', label: '👥 Members', items: [
    ['members', 'Members', Members, 'members.view'],
    ['memberrecord', 'Member Record', MemberLookup, 'members.view'],
  ] },
  ['visitors', '🧑‍🤝‍🧑 Visitors', Visitors, 'visitors.view'],
  ['followups', '📞 Follow-up', FollowUps, 'followups.view'],
  { group: 'ministry', label: '⛪ Ministry', items: [
    ['groups', 'Groups / House Fellowships', Groups, 'groups.view'],
    ['abcclass', 'ABC Class', ABCClass, 'groups.view'],
    ['prayer', 'Prayer Requests', PrayerRequests, 'prayer_requests.view'],
    ['departments', 'Departments', Departments, 'departments.view'],
    ['deptdashboard', 'Department Dashboard', DepartmentDashboard, 'departments.view'],
    ['serviceplans', 'Service Plans', ServicePlans, 'service_plans.view'],
    ['pastoral', 'Pastoral Care', PastoralCare, 'pastoral_cases.view'],
  ] },
  { group: 'attendance', label: '✅ Attendance', items: [
    ['attendance', 'Attendance Records', Attendance, 'attendance.view'],
    ['absentees', 'Absentee List', AbsenteeList, 'attendance.view'],
    ['adultcheckin', 'Adults Quick Attendance', AdultCheckIn, 'attendance.view'],
    ['omegacheckin', 'Omega Quick Attendance', OmegaCheckIn, 'attendance.view'],
    ['childrenattendance', 'Children Quick Attendance', ChildrenQuickAttendance, 'children.view'],
    ['childcheckin', 'Children Pickup / Release', ChildCheckIn, 'child_checkins.view'],
    ['headcount', 'Headcount', HeadcountAttendance, 'attendance.view'],
  ] },
  { group: 'events', label: '📅 Events', items: [
    ['events', 'Events', Events, 'events.view'],
  ] },
  { group: 'finance', label: '💰 Finance', items: [
    ['financecenter', 'Finance Center', FinanceCenter, 'finance.view'],
    ['financereconciliation', 'Reconciliation', FinanceReconciliation, 'finance_reconciliation.view'],
  ] },
  { group: 'welfare', label: '🤝 Welfare', items: [
    ['welfaredues', 'Welfare Dues', WelfareDues, 'welfare.view'],
    ['welfarefund', 'Welfare Fund', WelfareFund, 'welfare.view'],
  ] },
  { group: 'servicetimer', label: '⏱ Service Countdown', items: [
    ['servicetimer', 'Timer Setup', ServiceTimer, 'service_plans.view'],
    ['servicetimerlive', 'Live Countdown', ServiceTimerLive, 'service_plans.view'],
  ] },
  ['communications', '📢 Communication Center', CommunicationCenter, 'notifications.view'],
  ['notifications', '📣 Notification Center', NotificationCenter, 'notifications.view'],
  ['deliverycenter', '🚚 Delivery Center', DeliveryCenter, 'notifications.view'],
  ['engagement', '🤖 Engagement Automation', EngagementAutomation, 'notifications.manage'],
  ['automationcenter', '⚙️ Automation Center', AutomationCenter, 'notifications.manage'],
  ['advancedreports', '📊 Advanced Reports', AdvancedReports, 'advanced_reports.view'],
  ['pastordashboard', '🩺 Pastoral Dashboard', PastorDashboard, 'pastoral_cases.view'],
  ['sms', '💬 Send SMS', SendSMS, 'notifications.manage'],
  ['users', '🔑 Users', Users, 'users.view'],
  ['audit', '🧾 Audit Log', AuditLog, 'audit.view'],
  ['settings', '⚙ Settings', Settings, 'settings.view'],
  ['permissions', '🔐 Role Permissions', PermissionManager, 'permissions.view'],
];

function NavLabel({ label }) {
  const m = String(label || '').match(/^(\S+)(?:\s+)(.*)$/);
  if (!m || !/[^\x00-\x7F]/.test(m[1])) return label;
  return <><span className="navicon">{m[1]}</span><span>{m[2]}</span></>;
}

function SyncBadge() {
  const { online, syncError, syncing, pending, syncNow } = useData();
  const connected = online && !syncError;
  return (
    <button className="syncbadge" onClick={syncNow} title="Click to sync now">
      <span className={'dot ' + (connected ? 'ok' : 'off')} />
      {syncing ? 'Syncing…' : connected ? 'Online' : 'Offline'}
      {pending > 0 && <span className="pill">{pending} unsynced</span>}
    </button>
  );
}

const CURRENT_PERMISSION_CATALOG = [
  ['dashboard.view','dashboard','view','View Dashboard','Access the main dashboard'],
  ['members.view','members','view','View Members','View church member records'],
  ['members.create','members','create','Create Members','Create new member records'],
  ['members.edit','members','edit','Edit Members','Edit member records'],
  ['members.delete','members','delete','Delete Members','Delete member records'],
  ['attendance.view','attendance','view','View Attendance','View attendance records'],
  ['attendance.record','attendance','record','Record Attendance','Create attendance records'],
  ['attendance.edit','attendance','edit','Edit Attendance','Edit attendance records'],
  ['attendance.delete','attendance','delete','Delete Attendance','Delete attendance records'],
  ['children.view','children','view','View Children','View child records'],
  ['children.manage','children','manage','Manage Children','Create, edit and manage child records'],
  ['child_checkins.view','child_checkins','view','View Child Check-ins','Access children pickup and release'],
  ['child_checkins.manage','child_checkins','manage','Manage Child Check-ins','Manage children pickup and release'],
  ['groups.view','groups','view','View Groups','View groups and house fellowships'],
  ['groups.manage','groups','manage','Manage Groups','Create, edit and manage groups'],
  ['departments.view','departments','view','View Departments','View departments'],
  ['departments.manage','departments','manage','Manage Departments','Create, edit and manage departments'],
  ['events.view','events','view','View Events','View church events'],
  ['events.manage','events','manage','Manage Events','Create, edit and manage events'],
  ['visitors.view','visitors','view','View Visitors','View visitors'],
  ['visitors.manage','visitors','manage','Manage Visitors','Create, edit and manage visitors'],
  ['followups.view','follow_ups','view','View Follow-ups','View follow-up records'],
  ['followups.manage','follow_ups','manage','Manage Follow-ups','Create, edit and manage follow-ups'],
  ['prayer_requests.view','prayer_requests','view','View Prayer Requests','View prayer requests'],
  ['prayer_requests.manage','prayer_requests','manage','Manage Prayer Requests','Manage prayer requests'],
  ['pastoral_cases.view','pastoral_care','view','View Pastoral Care','View pastoral care cases and pastoral dashboard'],
  ['pastoral_cases.manage','pastoral_care','manage','Manage Pastoral Care','Create, edit and manage pastoral care cases'],
  ['notifications.view','notifications','view','View Notifications','View notification tools'],
  ['notifications.manage','notifications','manage','Manage Notifications','Manage church notifications'],
  ['finance.view','finance','view','View Finance','Access Finance Center and financial records'],
  ['finance.manage','finance','manage','Manage Finance','Create, edit and manage Finance Center records'],
  ['finance_reconciliation.view','finance_reconciliation','view','View Reconciliation','Access financial reconciliation'],
  ['finance_reconciliation.manage','finance_reconciliation','manage','Manage Reconciliation','Perform financial checking and reconciliation'],
  ['welfare.view','welfare','view','View Welfare','Access Welfare Dues and Welfare Fund'],
  ['welfare.manage','welfare','manage','Manage Welfare','Create, edit and manage Welfare records'],
  ['service_plans.view','service_plans','view','View Service Plans','View service plans and service countdown'],
  ['service_plans.manage','service_plans','manage','Manage Service Plans','Create, edit and manage service plans'],
  ['advanced_reports.view','advanced_reports','view','View Advanced Reports','Access advanced reports'],
  ['audit.view','audit','view','View Audit Log','View system audit records'],
  ['users.view','users','view','View Users','View application users'],
  ['users.manage','users','manage','Manage Users','Create, edit, delete and manage application users'],
  ['permissions.view','permissions','view','View Permissions','View role permissions'],
  ['permissions.manage','permissions','manage','Manage Permissions','Configure permissions for user groups'],
  ['settings.view','settings','view','View System Settings','Access system settings'],
  ['settings.manage','settings','manage','Manage System Settings','Change system settings'],
  ['backup.manage','backup','manage','Manage Backups','Access backup and restore controls'],
  ['clear_test_data.manage','clear_test_data','manage','Clear Test Data','Delete test/demo data'],
];

function PermissionManager() {
  const { role, hasPermission } = useAuth();
  const [roles, setRoles] = useState(ROLES.filter((r) => r !== 'pending'));
  const [roleLabels, setRoleLabels] = useState({});
  const [permissions, setPermissions] = useState([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleBase, setNewRoleBase] = useState('viewer');
  const [creatingRole, setCreatingRole] = useState(false);
  const [selectedRole, setSelectedRole] = useState('admin');
  const [enabled, setEnabled] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setMsg(''); setError('');
    try {
      const { data: roleRows, error: roleError } = await supabase.from('role_catalog').select('role_key,label,base_role,is_system').order('is_system',{ascending:false}).order('label');
      if (roleError) throw roleError;
      const visibleRoles = (roleRows || []).filter(r => r.role_key !== 'pending').map(r => r.role_key);
      const labels = Object.fromEntries((roleRows || []).map(r => [r.role_key, r.label]));
      setRoles(visibleRoles.length ? visibleRoles : ROLES.filter((r) => r !== 'pending'));
      setRoleLabels(labels);
      const [{ data: defs, error: defsError }, { data: rows, error: rowsError }] = await Promise.all([
        supabase.from('app_permissions').select('id, permission_key, module, action, label, description'),
        supabase.from('role_permissions').select('permission_id, enabled').eq('role', selectedRole),
      ]);
      if (defsError) throw defsError;
      if (rowsError) throw rowsError;

      const dbByKey = new Map((defs || []).map((p) => [p.permission_key, p]));
      const merged = CURRENT_PERMISSION_CATALOG.map(([key,module,action,label,description]) =>
        dbByKey.get(key) || { id: `new:${key}`, permission_key:key, module, action, label, description }
      );
      const byId = new Map(merged.map(p => [p.id, p.permission_key]));
      const next = {};
      (rows || []).forEach((r) => {
        const key = byId.get(r.permission_id) || (defs || []).find(p => p.id === r.permission_id)?.permission_key;
        if (key) next[key] = !!r.enabled;
      });
      if (selectedRole === 'super_admin') merged.forEach(p => { next[p.permission_key] = true; });
      setPermissions(merged); setEnabled(next);
    } catch (e) {
      setPermissions(CURRENT_PERMISSION_CATALOG.map(([key,module,action,label,description]) => ({id:`new:${key}`,permission_key:key,module,action,label,description})));
      setEnabled(selectedRole === 'super_admin' ? Object.fromEntries(CURRENT_PERMISSION_CATALOG.map(x=>[x[0],true])) : {});
      setError(e?.message || 'Could not load saved permissions. The current permission list is still shown.');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (role === 'super_admin' && hasPermission('permissions.view')) load(); }, [role, selectedRole]);

  const MODULE_ORDER = ['dashboard','members','attendance','children','child_checkins','groups','departments','events','visitors','follow_ups','prayer_requests','pastoral_care','notifications','finance','finance_reconciliation','welfare','service_plans','advanced_reports','audit','users','permissions','settings','backup','clear_test_data'];
  const LABELS = { dashboard:'Dashboard',members:'Members',attendance:'Attendance',children:'Children','child_checkins':'Children Check-in / Pickup',groups:'Groups',departments:'Departments',events:'Events',visitors:'Visitors',follow_ups:'Follow-ups',prayer_requests:'Prayer Requests',pastoral_care:'Pastoral Care',notifications:'Notifications',finance:'Finance',finance_reconciliation:'Finance Reconciliation',welfare:'Welfare',service_plans:'Service Plans',advanced_reports:'Advanced Reports',audit:'Audit Log',users:'User Management',permissions:'Permissions',settings:'System Settings',backup:'Backup',clear_test_data:'Clear Test Data' };
  const grouped = useMemo(() => {
    const out = {}; permissions.forEach(p => { if (!out[p.module]) out[p.module]=[]; out[p.module].push(p); });
    return Object.fromEntries(MODULE_ORDER.filter(m=>out[m]?.length).map(m=>[m,out[m]]));
  }, [permissions]);

  const togglePermission = (key) => { setEnabled(current => ({...current,[key]:!current[key]})); setMsg(''); };

  const save = async () => {
    if (selectedRole === 'super_admin') { setMsg('Super Admin always has full access.'); return; }
    setSaving(true); setMsg(''); setError('');
    try {
      const missing = permissions.filter(p => String(p.id).startsWith('new:'));
      if (missing.length) {
        const payload = missing.map(p => ({permission_key:p.permission_key,module:p.module,action:p.action,label:p.label,description:p.description}));
        const { error: insertError } = await supabase.from('app_permissions').upsert(payload, {onConflict:'permission_key'});
        if (insertError) throw insertError;
      }
      const { data: defs, error: defsError } = await supabase.from('app_permissions').select('id,permission_key').in('permission_key',permissions.map(p=>p.permission_key));
      if (defsError) throw defsError;
      const updates = (defs || []).map(p => supabase.from('role_permissions').upsert({role:selectedRole,permission_id:p.id,enabled:!!enabled[p.permission_key]},{onConflict:'role,permission_id'}));
      const results = await Promise.all(updates); const failed=results.find(r=>r.error); if(failed?.error) throw failed.error;
      setMsg(`Permissions for ${selectedRole.replace('_',' ')} saved successfully.`); await load();
    } catch (e) { setError(e?.message || String(e)); } finally { setSaving(false); }
  };

  const createRole = async () => {
    const label = newRoleName.trim();
    if (!label) return setError('Enter a role name.');
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    if (!key || ['super_admin','admin','finance','secretary','viewer','member','pending'].includes(key)) return setError('Choose a different role name.');
    setCreatingRole(true); setError(''); setMsg('');
    try {
      const { error } = await supabase.from('role_catalog').insert({role_key:key,label,base_role:newRoleBase,is_system:false});
      if (error) throw error;
      setNewRoleName('');
      setSelectedRole(key);
      await load();
      setMsg(`${label} role created. You can now configure its permissions below.`);
    } catch (e) { setError(e?.message || String(e)); } finally { setCreatingRole(false); }
  };

  if (role !== 'super_admin') return <section><h1>Role Permissions</h1><div className="card"><p>You do not have permission to manage role permissions.</p></div></section>;

  return <section className="permissions-page">
    <h1>🔐 Role Permissions</h1>
    <p className="muted permissions-intro">Configure access for each user group. Super Admin always has full access.</p>
    <div className="card permission-role-card"><label>User group</label><select value={selectedRole} onChange={e=>setSelectedRole(e.target.value)} disabled={loading||saving}>{roles.map(r=><option key={r} value={r}>{roleLabels[r] || r.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}</select></div>
    <div className="card permission-role-card">
      <h2 style={{marginTop:0}}>Add user group</h2>
      <p className="muted" style={{marginTop:0}}>Create another role whenever the church needs one. Choose the closest database access template; the checkboxes below then control the application's permissions for that role.</p>
      <div className="formgrid">
        <div className="fld"><small>Role name</small><input value={newRoleName} onChange={e=>setNewRoleName(e.target.value)} placeholder="e.g. Sunday School Teacher" disabled={creatingRole}/></div>
        <div className="fld"><small>Base access template</small><select value={newRoleBase} onChange={e=>setNewRoleBase(e.target.value)} disabled={creatingRole}><option value="viewer">Viewer — read access</option><option value="secretary">Secretary — operational access</option><option value="finance">Finance — financial access</option><option value="member">Member — member portal access</option></select></div>
      </div>
      <button className="secondary" onClick={createRole} disabled={creatingRole||!newRoleName.trim()}>{creatingRole?'Creating…':'＋ Add Role'}</button>
    </div>
    {loading ? <div className="card"><p className="muted">Loading permissions…</p></div> : <>
      {Object.entries(grouped).map(([module,items])=><div className="card permission-module" key={module}>
        <h2>{LABELS[module] || module}</h2>
        <div className="permission-list">{items.map(p=><label className="permission-row" key={p.permission_key}><input type="checkbox" checked={!!enabled[p.permission_key]} onChange={()=>togglePermission(p.permission_key)} disabled={saving||selectedRole==='super_admin'}/><span><strong>{p.label}</strong><small className="muted">{p.description}</small></span></label>)}</div>
      </div>)}
      {msg&&<div className="success" style={{marginBottom:8}}>{msg}</div>}{error&&<div className="err" style={{marginBottom:8}}>{error}</div>}
      <button className="primary" onClick={save} disabled={saving||loading||selectedRole==='super_admin'}>{saving?'Saving…':'Save Permissions'}</button>
    </>}
  </section>;
}

function Shell() {
  const { role, signOut, hasPermission } = useAuth();
  const { pending, wipe } = useData();
  const [page, setPage] = useState('dashboard');
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({});

  const allowed = ([id, , , need]) => {
    if (role === 'member') return id === 'memberportal' || id === 'settings';
    if (!need) return true;
    return hasPermission(need);
  };

  const menu = NAV
    .map((n) => (Array.isArray(n) ? n : { ...n, items: n.items.filter(allowed) }))
    .filter((n) => (Array.isArray(n) ? allowed(n) : n.items.length > 0));

  const flat = menu.flatMap((n) => (Array.isArray(n) ? [n] : n.items));
  const fallback = flat.find(([id]) => id === 'dashboard') || flat[0];
  const current = flat.find(([id]) => id === page) || fallback;
  const Current = current?.[2] || Dashboard;
  const currentId = current?.[0] || 'dashboard';

  const go = (id) => { setPage(id); setOpen(false); };
  const toggle = (g) => setOpenGroups((o) => ({ ...o, [g]: !o[g] }));

  async function logout() {
    if (pending > 0 && !confirm(`You have ${pending} unsynced change(s). They stay on this device and will sync the next time you sign in with internet. Sign out anyway?`)) return;
    // Preserve this user's local cache and offline outbox when signing out.
    // The cache is keyed by the user's Supabase id, so it remains isolated.
    // Clearing it here made the next offline session reopen with empty data.
    await signOut();
  }

  return (
    <div className="app">
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand"><img src="/icgc-logo.png" alt="I.C.G.C logo" /><div><strong>{CHURCH}</strong><small>Management System</small></div></div>
        <div className="nav">
          {menu.map((n) => {
            if (Array.isArray(n)) {
              const [id, label] = n;
              return <button key={id} className={currentId === id ? 'active' : ''} onClick={() => go(id)}><NavLabel label={label} /></button>;
            }
            const hasActive = n.items.some(([id]) => id === currentId);
            const expanded = openGroups[n.group] ?? hasActive;
            return (
              <div key={n.group} className="navgroup">
                <button className={'grouphead' + (hasActive ? ' hasactive' : '')} onClick={() => toggle(n.group)} aria-expanded={expanded}>
                  <span><NavLabel label={n.label} /></span><span className={'chev' + (expanded ? ' open' : '')}>▸</span>
                </button>
                {expanded && n.items.map(([id, label]) => (
                  <button key={id} className={'sub' + (currentId === id ? ' active' : '')} onClick={() => go(id)}><NavLabel label={label} /></button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <button className="mobile-menu" onClick={() => setOpen(!open)}>☰</button>
            <SyncBadge />
          </div>
          <button className="secondary" onClick={logout}>Sign out</button>
        </div>
        <Current />
      </main>
    </div>
  );
}
