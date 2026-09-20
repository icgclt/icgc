import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export const ROLES = ['admin', 'finance', 'secretary', 'viewer', 'pending'];
const READ_ALL = ['admin', 'finance', 'secretary', 'viewer'];

// Mirrors the row-level security policies in supabase/schema.sql (the database is the real enforcer;
// this only decides which buttons and pages to show).
export const PERMS = {
  members:     { read: READ_ALL, write: ['admin', 'secretary'], del: ['admin'] },
  attendance:  { read: READ_ALL, write: ['admin', 'secretary'], del: ['admin'] },
  departments: { read: READ_ALL, write: ['admin', 'secretary'], del: ['admin'] },
  events:      { read: READ_ALL, write: ['admin', 'secretary'], del: ['admin'] },
  giving:      { read: ['admin', 'finance'], write: ['admin', 'finance'], del: ['admin'] },
};
export const can = (role, table, action) => PERMS[table]?.[action]?.includes(role) || false;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (user) => {
    if (!user) { setProfile(null); return; }
    const ck = `cm:profile:${user.id}`;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (data) {
      setProfile(data);
      try { localStorage.setItem(ck, JSON.stringify(data)); } catch { /* ignore */ }
    } else if (error) {
      // offline / server unreachable: fall back to the last known profile for this signed-in user
      try { const c = JSON.parse(localStorage.getItem(ck)); if (c) setProfile(c); } catch { /* ignore */ }
    } else {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session?.user);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // defer: calling supabase inside this callback can deadlock the auth client
      setTimeout(() => loadProfile(s?.user), 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    role: profile?.role,
    loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, fullName) =>
      supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),
    signOut: () => supabase.auth.signOut(),
    refreshProfile: () => loadProfile(session?.user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
