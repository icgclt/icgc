// Supabase Edge Function: admin-users
//
// Lets an ADMIN create user accounts, set their role, reset their password and delete them.
// This needs the service_role key, which must never reach the browser, so it lives here.
// Supabase provides SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to functions automatically.
//
// Deploy:  supabase functions deploy admin-users
// (nothing else to configure)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ROLES = ['admin', 'finance', 'secretary', 'viewer', 'pending'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 1. Who is calling? Must be a signed-in admin.
    const authHeader = req.headers.get('Authorization') || '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await caller.auth.getUser();
    if (authErr || !user) return json({ error: 'Not signed in.' }, 401);
    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ error: 'Only an administrator can do this.' }, 403);

    // 2. Privileged client (bypasses RLS) used only after the admin check above.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json();
    const { action } = body;

    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const role = body.role || 'viewer';
      const fullName = String(body.full_name || '').trim();
      if (!email) return json({ error: 'Email is required.' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);
      if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400);

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error) return json({ error: error.message }, 400);
      // the signup trigger creates the profile as 'pending'; set the chosen role now
      const { error: pErr } = await admin.from('profiles')
        .update({ role, full_name: fullName }).eq('id', data.user.id);
      if (pErr) return json({ error: 'Account created but role could not be set: ' + pErr.message }, 500);
      return json({ ok: true, id: data.user.id });
    }

    if (action === 'reset_password') {
      const password = String(body.password || '');
      if (!body.user_id) return json({ error: 'user_id is required.' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      if (!body.user_id) return json({ error: 'user_id is required.' }, 400);
      if (body.user_id === user.id) return json({ error: 'You cannot delete your own account.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(body.user_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
