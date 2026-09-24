import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export const ROLES = ['admin', 'finance', 'secretary', 'viewer', 'member', 'pending'];
// Mirrors the row-level security policies in supabase/schema.sql (the database is the real enforcer;
// this only decides which buttons and pages to show).
export const PERMS = {
  members:                { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  attendance:             { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  attendance_headcount:   { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  departments:            { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  events:                 { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  welfare_members:        { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  giving:                 { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  offering_entries:       { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  member_contributions:   { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  welfare_transactions:   { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  visitors:               { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  groups:                 { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  follow_ups:             { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  prayer_requests:        { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  service_plans:          { read: ['admin','finance','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  pastoral_cases:         { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  families:               { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  children:               { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  child_checkins:         { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  department_members:     { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  group_members:          { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  group_attendance:      { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  volunteer_schedules:   { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  pledges:               { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  payment_receipts:      { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  communication_templates:   { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  communication_queue:   { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  finance_reconciliations:{ read: ['admin','finance'], write: ['admin','finance'], del: ['admin'] },
};
export const can = (role, table, action) => PERMS[table]?.[action]?.includes(role) || false;

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false); // true while the user is setting a new password from an emailed link

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
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
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
    recovery,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, fullName) =>
      supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),
    signOut: () => supabase.auth.signOut(),
    // emails a reset link (used by 'Forgot password?' on the login page)
    sendResetEmail: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    // sets a new password for the signed-in user (recovery link or Settings > Change password)
    updatePassword: async (password) => {
      const res = await supabase.auth.updateUser({ password });
      if (!res.error) setRecovery(false);
      return res;
    },
    refreshProfile: () => loadProfile(session?.user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
