import { useState } from 'react';
import { configured } from './supabase';
import { AuthProvider, useAuth, can } from './auth';
import { DataProvider, useData } from './data';
import { Dashboard, Members, Attendance, Giving, Departments, Events, Reports, Users, Settings } from './pages';

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
  const { loading, user, profile, role } = useAuth();
  if (loading) return <div className="login"><div className="loginbox"><h1>{CHURCH}</h1><p className="muted">Loading…</p></div></div>;
  if (!user) return <Login />;
  if (!profile || role === 'pending') return <Pending />;
  return (
    <DataProvider key={user.id} uid={user.id}>
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
  const { signIn, signUp } = useAuth();
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
        <p className="muted">{mode === 'in' ? 'Sign in to continue.' : 'Create your account. An administrator must approve it before you can see any data.'}</p>
        {mode === 'up' && <><label>Full name</label><input value={f.name} onChange={set('name')} required /></>}
        <label>Email</label><input type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
        <label>Password</label><input type="password" value={f.password} onChange={set('password')} required autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
        {msg && <div className="err" style={{ marginBottom: 12 }}>{msg}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
        <p style={{ textAlign: 'center', marginBottom: 0 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setMsg(''); setMode(mode === 'in' ? 'up' : 'in'); }}>
            {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </a>
        </p>
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

const NAV = [
  ['dashboard', '📊 Dashboard', Dashboard, null],
  ['members', '👥 Members', Members, 'members'],
  ['attendance', '✅ Attendance', Attendance, 'attendance'],
  ['giving', '💰 Giving', Giving, 'giving'],
  ['departments', '🏛 Departments', Departments, 'departments'],
  ['events', '📅 Events', Events, 'events'],
  ['reports', '📈 Reports', Reports, null],
  ['users', '🔑 Users', Users, 'ADMIN'],
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

  const items = NAV.filter(([, , , need]) => (need === null ? true : need === 'ADMIN' ? role === 'admin' : can(role, need, 'read')));
  const Current = (items.find(([id]) => id === page) || items[0])[2];

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
          {items.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setOpen(false); }}>{label}</button>
          ))}
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
