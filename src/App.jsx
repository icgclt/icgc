import { useEffect, useMemo, useState } from 'react';
import { configured, supabase } from './supabase';
import { AuthProvider, useAuth, can } from './auth';
import { DataProvider, useData } from './data';
import {
  Dashboard, Members, Attendance, HeadcountAttendance, Offerings, EventAttendance, ServiceTimer, ServiceTimerLive,
  FirstFruit, Departments, Events, Reports, Users, Settings, SendSMS,
  WelfareDues, WelfareFund, Visitors, Groups, FollowUps, PrayerRequests, ServicePlans, PastoralCare, AuditLog, MemberPortal, ABCClass, ChildrenQuickAttendance, ChildCheckIn, AdultCheckIn, OmegaCheckIn, CommunicationCenter, PastorDashboard, MemberGiving, EngagementAutomation, FinanceReconciliation, AutomationCenter, AdvancedReports, NotificationCenter, MobileMoneyPayments, DeliveryCenter, MemberLookup,
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
  if (recovery || user?.user_metadata?.must_change_password === true) return <SetNewPassword forced={user?.user_metadata?.must_change_password === true} />;
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
        const { error } = await signIn(f.email.trim(), f.password);
        if (error) setMsg(String(error.message || ''));
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
        <h1>⛪ {CHURCH}</h1>
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
    ['adultcheckin', 'Adults Quick Attendance', AdultCheckIn, 'attendance.view'],
    ['omegacheckin', 'Omega Quick Attendance', OmegaCheckIn, 'attendance.view'],
    ['childrenattendance', 'Children Quick Attendance', ChildrenQuickAttendance, 'children.view'],
    ['childcheckin', 'Children Pickup / Release', ChildCheckIn, 'child_checkins.view'],
    ['headcount', 'Headcount', HeadcountAttendance, 'attendance.view'],
  ] },
  { group: 'events', label: '📅 Events', items: [
    ['events', 'Events', Events, 'events.view'],
    ['eventattendance', 'Event Attendance', EventAttendance, 'attendance.view'],
  ] },
  { group: 'finance', label: '💰 Finance', items: [
    ['offerings', 'Offerings', Offerings, 'giving.view'],
    ['firstfruit', 'First Fruit', FirstFruit, 'contributions.view'],
    ['membergiving', 'Digital Receipts', MemberGiving, 'payments.view'],
    ['mobilemoney', 'Mobile Money Payments', MobileMoneyPayments, 'payments.view'],
    ['financereconciliation', 'Reconciliation', FinanceReconciliation, 'payments.view'],
  ] },
  { group: 'welfare', label: '🤝 Welfare', items: [
    ['welfaredues', 'Welfare Dues', WelfareDues, 'contributions.view'],
    ['welfarefund', 'Welfare Fund', WelfareFund, 'payments.view'],
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
  ['reports', '📈 Reports', Reports, 'reports.view'],
  ['advancedreports', '📊 Advanced Reports', AdvancedReports, 'advanced_reports.view'],
  ['pastordashboard', '🩺 Pastoral Dashboard', PastorDashboard, 'pastoral_cases.view'],
  ['sms', '💬 Send SMS', SendSMS, 'notifications.manage'],
  ['users', '🔑 Users', Users, 'users.view'],
  ['audit', '🧾 Audit Log', AuditLog, 'reports.view'],
  ['settings', '⚙ Settings', Settings, 'settings.view'],
  ['permissions', '🔐 Role Permissions', PermissionManager, 'permissions.view'],
];

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

function PermissionManager() {
  const { role, hasPermission } = useAuth();
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRole, setSelectedRole] = useState('admin');
  const [enabled, setEnabled] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setMsg('');
    setError('');

    const [{ data: defs, error: defsError }, { data: rows, error: rowsError }] = await Promise.all([
      supabase.from('app_permissions').select('id, permission_key, module, action, label, description').order('module').order('action').order('permission_key'),
      supabase.from('role_permissions').select('permission_id, enabled').eq('role', selectedRole),
    ]);

    if (defsError || rowsError) {
      setError(defsError?.message || rowsError?.message || 'Could not load permissions.');
      setLoading(false);
      return;
    }

    const next = {};
    (rows || []).forEach((r) => { next[r.permission_id] = !!r.enabled; });

    setPermissions(defs || []);
    setEnabled(next);
    setRoles(['admin', 'finance', 'secretary', 'viewer', 'member', 'pending']);
    setLoading(false);
  };

  useEffect(() => {
    if (role === 'super_admin' && hasPermission('permissions.view')) load();
  }, [role, selectedRole]);

  const grouped = useMemo(() => {
    const out = {};
    permissions.forEach((p) => {
      if (!out[p.module]) out[p.module] = [];
      out[p.module].push(p);
    });
    return out;
  }, [permissions]);

  const togglePermission = (id) => {
    setEnabled((current) => ({ ...current, [id]: !current[id] }));
    setMsg('');
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    setError('');

    try {
      const updates = permissions.map((p) =>
        supabase
          .from('role_permissions')
          .update({ enabled: !!enabled[p.id] })
          .eq('role', selectedRole)
          .eq('permission_id', p.id)
      );

      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;

      setMsg(`Permissions for ${selectedRole.replace('_', ' ')} saved successfully.`);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (role !== 'super_admin') {
    return (
      <section>
        <h1>Role Permissions</h1>
        <div className="card">
          <p>You do not have permission to manage role permissions.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>🔐 Role Permissions</h1>
      <p className="muted">Configure which parts of the application each user group can access. Super Admin always has full access.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label>User group</label>
        <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} disabled={loading || saving}>
          {roles.map((r) => <option key={r} value={r}>{r.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="card"><p className="muted">Loading permissions…</p></div>
      ) : (
        <>
          {Object.entries(grouped).map(([module, items]) => (
            <div className="card" key={module} style={{ marginBottom: 14 }}>
              <h2 style={{ marginTop: 0, textTransform: 'capitalize' }}>{module.replace(/_/g, ' ')}</h2>
              <div style={{ display: 'grid', gap: 10 }}>
                {items.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!enabled[p.id]}
                      onChange={() => togglePermission(p.id)}
                      disabled={saving}
                    />
                    <span>
                      <strong>{p.label}</strong>
                      <small style={{ display: 'block' }} className="muted">{p.description || p.permission_key}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}
          {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

          <button className="primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        </>
      )}
    </section>
  );
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
    if (pending === 0) wipe();
    await signOut();
  }

  return (
    <div className="app">
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand">⛪ {CHURCH}<small>Management System</small></div>
        <div className="nav">
          {menu.map((n) => {
            if (Array.isArray(n)) {
              const [id, label] = n;
              return <button key={id} className={currentId === id ? 'active' : ''} onClick={() => go(id)}>{label}</button>;
            }
            const hasActive = n.items.some(([id]) => id === currentId);
            const expanded = openGroups[n.group] ?? hasActive;
            return (
              <div key={n.group} className="navgroup">
                <button className={'grouphead' + (hasActive ? ' hasactive' : '')} onClick={() => toggle(n.group)} aria-expanded={expanded}>
                  <span>{n.label}</span><span className={'chev' + (expanded ? ' open' : '')}>▸</span>
                </button>
                {expanded && n.items.map(([id, label]) => (
                  <button key={id} className={'sub' + (currentId === id ? ' active' : '')} onClick={() => go(id)}>{label}</button>
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
