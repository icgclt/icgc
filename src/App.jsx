import { useState } from 'react';
import { configured } from './supabase';
import { AuthProvider, useAuth, can } from './auth';
import { DataProvider, useData } from './data';
import {
  Dashboard, Members, Attendance, QuickAttendance, HeadcountAttendance, Giving, Offerings,
  FirstFruit, Departments, Events, Reports, Users, Settings, SendSMS,
  WelfareMembers, WelfareDues, WelfareFund, Visitors, Groups, FollowUps, PrayerRequests, Volunteers, ServicePlans, PastoralCare, AuditLog, MemberPortal,
} from './pages';

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
  if (recovery) return <SetNewPassword />;
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
        if (error) setMsg(error.message);
      } else if (mode === 'forgot') {
        const { error } = await sendResetEmail(f.email.trim());
        setMsg(error ? error.message : 'If that email has an account, a reset link has been sent. Open it on this device.');
      } else {
        if (f.password.length < 6) { setMsg('Password must be at least 6 characters.'); return; }
        const { data, error } = await signUp(f.email.trim(), f.password, f.name.trim());
        if (error) setMsg(error.message);
        else if (!data.session) { setMsg('Account created. Check your email to confirm it, then sign in.'); setMode('in'); }
      }
    } catch (err) {
      setMsg('Could not reach the server. Check your internet connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="loginbox" onSubmit={submit}>
        <h1>⛪ {CHURCH}</h1>
        <p className="muted">{mode === 'in' ? 'Sign in to continue.' : mode === 'forgot' ? 'Enter your email and we will send you a link to reset your password.' : 'Create your account. An administrator must approve it before you can see any data.'}</p>
        {mode === 'up' && <><label>Full name</label><input value={f.name} onChange={set('name')} required /></>}
        <label>Email</label><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
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

function SetNewPassword() {
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
    if (error) setMsg(error.message); // on success the app continues to the dashboard
  }
  return (
    <div className="login">
      <form className="loginbox" onSubmit={submit}>
        <h1>Set a new password</h1>
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

// A plain entry is [id, label, Component, permissionTable|null|'ADMIN'].
// A group is { group, label, items: [...entries] } and shows as one expandable menu item.
const NAV = [
  ['dashboard', '📊 Dashboard', Dashboard, null],
  ['memberportal', '🙋 My Church', MemberPortal, null],
  ['members', '👥 Members', Members, 'members'],
  ['visitors', '🧑‍🤝‍🧑 Visitors', Visitors, 'visitors'],
  ['followups', '📞 Follow-up', FollowUps, 'follow_ups'],
  { group: 'ministry', label: '⛪ Ministry', items: [
    ['groups', 'Groups / House Fellowships', Groups, 'groups'],
    ['prayer', 'Prayer Requests', PrayerRequests, 'prayer_requests'],
    ['volunteers', 'Volunteers', Volunteers, 'volunteers'],
    ['serviceplans', 'Service Plans', ServicePlans, 'service_plans'],
    ['pastoral', 'Pastoral Care', PastoralCare, 'pastoral_cases'],
  ] },
  { group: 'attendance', label: '✅ Attendance', items: [
    ['attendance', 'Attendance Records', Attendance, 'attendance'],
    ['quickattendance', 'Quick Attendance', QuickAttendance, 'attendance'],
    ['headcount', 'Headcount Attendance', HeadcountAttendance, 'attendance_headcount'],
  ] },
  { group: 'finance', label: '💰 Finance', items: [
    ['giving', 'Giving', Giving, 'giving'],
    ['offerings', 'Offerings', Offerings, 'offering_entries'],
    ['firstfruit', 'First Fruit', FirstFruit, 'member_contributions'],
  ] },
  { group: 'welfare', label: '🤝 Welfare', items: [
    ['welfaremembers', 'Welfare Members', WelfareMembers, 'welfare_members'],
    ['welfaredues', 'Welfare Dues', WelfareDues, 'member_contributions'],
    ['welfarefund', 'Welfare Fund', WelfareFund, 'welfare_transactions'],
  ] },
  ['departments', '🏛 Departments', Departments, 'departments'],
  ['events', '📅 Events', Events, 'events'],
  ['sms', '💬 Send SMS', SendSMS, 'members'],
  ['reports', '📈 Reports', Reports, null],
  ['users', '🔑 Users', Users, 'ADMIN'],
  ['audit', '🧾 Audit Log', AuditLog, 'ADMIN'],
  ['settings', '⚙ Settings', Settings, null],
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

function Shell() {
  const { role, signOut } = useAuth();
  const { pending, wipe } = useData();
  const [page, setPage] = useState('dashboard');
  const [open, setOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({});

  const allowed = ([id, , , need]) => role === 'member' ? (id === 'memberportal' || id === 'settings') : (need === null ? true : need === 'ADMIN' ? role === 'admin' : can(role, need, 'read'));
  // keep only the pages this role may see; drop groups that end up empty
  const menu = NAV
    .map((n) => (Array.isArray(n) ? n : { ...n, items: n.items.filter(allowed) }))
    .filter((n) => (Array.isArray(n) ? allowed(n) : n.items.length > 0));
  const flat = menu.flatMap((n) => (Array.isArray(n) ? [n] : n.items));
  const Current = (flat.find(([id]) => id === page) || flat[0])[2];
  const currentId = (flat.find(([id]) => id === page) || flat[0])[0];

  const go = (id) => { setPage(id); setOpen(false); };
  const toggle = (g) => setOpenGroups((o) => ({ ...o, [g]: !o[g] }));

  async function logout() {
    if (pending > 0 && !confirm(`You have ${pending} unsynced change(s). They stay on this device and will sync the next time you sign in with internet. Sign out anyway?`)) return;
    if (pending === 0) wipe(); // leave nothing behind on shared devices once everything is synced
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
            const expanded = openGroups[n.group] ?? hasActive; // the group holding the current page is open by default
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
