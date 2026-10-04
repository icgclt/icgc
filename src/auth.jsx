import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

export function normalizePhone(value) {
  const raw = String(value || '').trim().replace(/[\s()-]/g, '');
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('233')) return '+' + raw;
  if (raw.startsWith('0')) return '+233' + raw.slice(1);
  return raw;
}

export function memberLoginEmail(value) {
  const phone = normalizePhone(value);
  const digits = phone.replace(/\D/g, '');
  if (!/^233\d{9}$/.test(digits)) return '';
  return `member-${digits}@members.icgctt.local`;
}

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export const ROLES = ['super_admin', 'admin', 'finance', 'secretary', 'viewer', 'member', 'sunday_school_teacher', 'pending'];
export const effectiveRole = (role) => role === 'super_admin' ? 'admin' : role;
export const isSuperAdmin = (role) => role === 'super_admin';
export const isAdmin = (role) => role === 'admin' || role === 'super_admin';
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
  pastoral_cases:        { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  families:               { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  children:               { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  child_checkins:         { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  department_members:     { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  group_members:          { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  group_attendance:      { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  volunteer_schedules:   { read: ['admin','secretary','viewer'], write: ['admin','secretary'], del: ['admin'] },
  pledges:               { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  payment_receipts:      { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  communication_templates: { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  communication_queue:   { read: ['admin','secretary'], write: ['admin','secretary'], del: ['admin'] },
  finance_reconciliations:{ read: ['admin','finance'], write: ['admin','finance'], del: ['admin'] },
  finance_weekly_reports:  { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  finance_weekly_cash_counts:{ read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  finance_weekly_momo:    { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  finance_weekday_collections: { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  finance_weekday_cash_counts: { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
  finance_weekday_momo: { read: ['admin','finance','secretary','viewer'], write: ['admin','finance'], del: ['admin'] },
};
export const can = (role, table, action) => PERMS[table]?.[action]?.includes(effectiveRole(role)) || false;

const OFFLINE_AUTH_PREFIX = 'cm:offline-auth:v1:';
const OFFLINE_AUTH_INDEX = 'cm:offline-auth:index:v1';

function normalizeLoginIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  return raw.includes('@') ? raw.toLowerCase() : memberLoginEmail(raw).toLowerCase();
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveOfflineVerifier(password, saltBytes) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure offline authentication is unavailable in this browser.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 120000, hash: 'SHA-256' }, material, 256);
  return new Uint8Array(bits);
}

async function cacheOfflineCredential(identifier, password, user, profile, permissions) {
  const key = normalizeLoginIdentifier(identifier);
  if (!key || !user?.id || !password) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveOfflineVerifier(password, salt);
  const record = {
    version: 1,
    user: { id: user.id, email: user.email || null, phone: user.phone || null, user_metadata: user.user_metadata || {} },
    profile: profile || null,
    permissions: Array.isArray(permissions) ? permissions : [],
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(verifier),
    updated_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(OFFLINE_AUTH_PREFIX + key, JSON.stringify(record));
    const index = JSON.parse(localStorage.getItem(OFFLINE_AUTH_INDEX) || '[]');
    if (!index.includes(key)) localStorage.setItem(OFFLINE_AUTH_INDEX, JSON.stringify([...index, key]));
  } catch { /* storage may be unavailable */ }
}

async function readOfflineCredential(identifier, password) {
  const key = normalizeLoginIdentifier(identifier);
  if (!key) return null;
  try {
    const record = JSON.parse(localStorage.getItem(OFFLINE_AUTH_PREFIX + key) || 'null');
    if (!record?.salt || !record?.verifier || !record?.user?.id) return null;
    const actual = await deriveOfflineVerifier(password, base64ToBytes(record.salt));
    const expected = base64ToBytes(record.verifier);
    if (actual.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0 ? record : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const loadPermissions = useCallback(async (user) => {
    if (!user) { setPermissions([]); setPermissionsLoading(false); return []; }
    setPermissionsLoading(true);
    try {
      const { data: profileData, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (profileError) { setPermissions([]); return []; }
      const userRole = profileData?.role;
      if (userRole === 'super_admin') {
        const { data: allPermissions, error: allError } = await supabase.from('app_permissions').select('permission_key');
        const list = !allError ? (allPermissions || []).map((p) => p.permission_key).filter(Boolean) : [];
        setPermissions(list);
        return list;
      }
      if (!userRole) { setPermissions([]); return []; }
      const { data, error } = await supabase.from('role_permissions').select(`enabled, app_permissions ( permission_key )`).eq('role', userRole).eq('enabled', true);
      if (error) { setPermissions([]); return []; }
      const list = (data || []).map((row) => row.app_permissions?.permission_key).filter(Boolean);
      setPermissions(list);
      return list;
    } finally { setPermissionsLoading(false); }
  }, []);

  const loadProfile = useCallback(async (user) => {
    if (!user) { setProfile(null); setPermissions([]); setPermissionsLoading(false); return null; }
    const ck = `cm:profile:${user.id}`;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (data) {
      setProfile(data);
      try { localStorage.setItem(ck, JSON.stringify(data)); } catch { /* ignore */ }
      return await loadPermissions(user);
    }
    if (error) {
      try {
        const c = JSON.parse(localStorage.getItem(ck));
        if (c) { setProfile(c); const cachedPerms = JSON.parse(localStorage.getItem(`cm:permissions:${user.id}`) || '[]'); setPermissions(Array.isArray(cachedPerms) ? cachedPerms : []); return cachedPerms; }
      } catch { /* ignore */ }
    } else { setProfile(null); setPermissions([]); }
    return [];
  }, [loadPermissions]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session?.user);
      if (alive) setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
      setTimeout(() => loadProfile(s?.user), 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = async (identifier, password) => {
    const v = String(identifier || '').trim();
    const email = v.includes('@') ? v.toLowerCase() : memberLoginEmail(v);
    if (!email) return { data: { user: null, session: null }, error: { message: 'Enter a valid Ghanaian phone number, for example 0244457816.' } };

    if (!navigator.onLine) {
      const cached = await readOfflineCredential(v, password);
      if (!cached) return { data: { user: null, session: null }, error: { message: 'Offline sign-in failed. This device has no saved sign-in for that account, or the password does not match the saved offline credential.' } };
      setSession({ offline: true, access_token: null, refresh_token: null, user: cached.user });
      setProfile(cached.profile);
      setPermissions(Array.isArray(cached.permissions) ? cached.permissions : []);
      return { data: { user: cached.user, session: { offline: true, user: cached.user } }, error: null, offline: true };
    }

    let result;
    try {
      result = await supabase.auth.signInWithPassword({ email, password });
    } catch (e) {
      const message = String(e?.message || e || '');
      const networkFailure = /failed to fetch|networkerror|network request failed|fetch failed|load failed|timeout|timed out/i.test(message);
      if (networkFailure) {
        const cached = await readOfflineCredential(v, password);
        if (cached) {
          setSession({ offline: true, access_token: null, refresh_token: null, user: cached.user });
          setProfile(cached.profile);
          setPermissions(Array.isArray(cached.permissions) ? cached.permissions : []);
          return { data: { user: cached.user, session: { offline: true, user: cached.user } }, error: null, offline: true };
        }
        return { data: { user: null, session: null }, error: { message: 'The phone cannot reach the church server right now. If this phone has signed in successfully before, reconnect and try again so its offline sign-in can be saved.' } };
      }
      throw e;
    }
    if (result.error || !result.data?.user) {
      const message = String(result.error?.message || '');
      const networkFailure = /failed to fetch|networkerror|network request failed|fetch failed|load failed|timeout|timed out/i.test(message);
      if (networkFailure) {
        const cached = await readOfflineCredential(v, password);
        if (cached) {
          setSession({ offline: true, access_token: null, refresh_token: null, user: cached.user });
          setProfile(cached.profile);
          setPermissions(Array.isArray(cached.permissions) ? cached.permissions : []);
          return { data: { user: cached.user, session: { offline: true, user: cached.user } }, error: null, offline: true };
        }
      }
      return result;
    }
    try {
      const { data: p } = await supabase.from('profiles').select('*').eq('id', result.data.user.id).maybeSingle();
      let perms = [];
      if (p?.role === 'super_admin') {
        const { data: all } = await supabase.from('app_permissions').select('permission_key');
        perms = (all || []).map((x) => x.permission_key).filter(Boolean);
      } else if (p?.role) {
        const { data: rows } = await supabase.from('role_permissions').select(`enabled, app_permissions ( permission_key )`).eq('role', p.role).eq('enabled', true);
        perms = (rows || []).map((x) => x.app_permissions?.permission_key).filter(Boolean);
      }
      try { localStorage.setItem(`cm:permissions:${result.data.user.id}`, JSON.stringify(perms)); } catch { /* ignore */ }
      if (p) try { localStorage.setItem(`cm:profile:${result.data.user.id}`, JSON.stringify(p)); } catch { /* ignore */ }
      await cacheOfflineCredential(v, password, result.data.user, p, perms);
    } catch { /* keep online sign-in successful even if offline cache cannot be refreshed */ }
    return result;
  };

  const value = {
    session, user: session?.user ?? null, profile, role: profile?.role, permissions, permissionsLoading,
    hasPermission: (permissionKey) => profile?.role === 'super_admin' || permissions.includes(permissionKey),
    loading, recovery,
    signIn,
    signUp: (email, password, fullName) => supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),
    signOut: () => { setSession(null); setProfile(null); setPermissions([]); return supabase.auth.signOut(); },
    sendResetEmail: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    updatePassword: async (password) => {
      const res = await supabase.auth.updateUser({ password });
      if (res.error) return res;
      let nextUser = res.data?.user;
      // The forced-change flag lives in app_metadata, which the browser cannot edit directly.
      // A database function clears it for the signed-in user, then we refresh the session to pick it up.
      if (nextUser?.app_metadata?.must_change_password) {
        const { error: clearError } = await supabase.rpc('clear_must_change_password');
        if (clearError) return { data: res.data, error: { message: 'Password saved, but the first-login flag could not be cleared. Run migration_43 in Supabase, then try again. (' + clearError.message + ')' } };
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session?.user) nextUser = refreshed.session.user;
      }
      setRecovery(false);
      if (nextUser) {
        setSession((prev) => prev ? { ...prev, user: nextUser } : prev);
        try { await cacheOfflineCredential(nextUser.email || '', password, nextUser, profile, permissions); } catch { /* keep password update successful if local caching is unavailable */ }
      }
      return res;
    },
    refreshProfile: async () => { await loadProfile(session?.user); await loadPermissions(session?.user); },
    refreshPermissions: () => loadPermissions(session?.user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
