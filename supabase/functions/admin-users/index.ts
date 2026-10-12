import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

function normalizeGhanaPhone(value: string) {
  let phone = String(value || '').trim().replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(phone)) phone = '+233' + phone.slice(1);
  else if (/^233\d{9}$/.test(phone)) phone = '+' + phone;
  return phone;
}

function memberLoginEmail(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return /^233\d{9}$/.test(digits) ? `member-${digits}@members.icgctt.local` : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await caller.auth.getUser();
    if (authErr || !user) return json({ error: 'Not signed in.' }, 401);

    const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!['super_admin', 'admin'].includes(me?.role)) return json({ error: 'Only a Super Admin or Admin can do this.' }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json();
    const action = String(body.action || '');

    if (action === 'create') {
      const memberId = String(body.member_id || '');
      const fullName = String(body.full_name || '').trim();
      const rawPhone = String(body.phone || '').trim();
      const role = String(body.role || 'viewer');
      const password = String(body.password || '');

      if (!memberId) return json({ error: 'member_id is required.' }, 400);
      if (!fullName) return json({ error: 'Full name is required.' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);

      const phone = normalizeGhanaPhone(rawPhone);
      if (!/^\+233\d{9}$/.test(phone)) return json({ error: 'Please select a member with a valid Ghanaian phone number.' }, 400);
      const email = memberLoginEmail(phone);
      if (!email) return json({ error: 'Could not create the Testimony Temple login identifier.' }, 400);

      const { data: member, error: memberErr } = await admin.from('members')
        .select('id,name,phone,user_id')
        .eq('id', memberId)
        .maybeSingle();
      if (memberErr || !member) return json({ error: memberErr?.message || 'Member not found.' }, 404);
      if (String(member.phone || '') && normalizeGhanaPhone(member.phone) !== phone) {
        return json({ error: 'The selected member phone number changed. Please select the member again.' }, 400);
      }

      const { data: roleDef, error: roleErr } = await admin.from('role_catalog').select('role_key').eq('role_key', role).maybeSingle();
      if (roleErr || !roleDef || role === 'pending') return json({ error: 'Invalid role.' }, 400);

      // Prevent duplicate Auth accounts for this phone/login alias.
      const { data: users, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) return json({ error: 'Could not check existing user accounts: ' + listErr.message }, 500);
      const existing = users.users.find(u => String(u.email || '').toLowerCase() === email.toLowerCase());
      if (existing) return json({ error: 'A login account already exists for this member phone number.' }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, member_id: memberId, member_phone: phone },
      });
      if (createErr || !created?.user) return json({ error: createErr?.message || 'Could not create the Auth user.' }, 400);

      const authUserId = created.user.id;
      const { error: profileErr } = await admin.from('profiles').upsert({
        id: authUserId,
        full_name: fullName,
        role,
        member_id: memberId,
      }, { onConflict: 'id' });
      if (profileErr) {
        await admin.auth.admin.deleteUser(authUserId);
        return json({ error: 'Auth account was rolled back because the profile row could not be created: ' + profileErr.message }, 500);
      }

      const { error: linkErr } = await admin.from('members').update({ user_id: authUserId }).eq('id', memberId);
      if (linkErr) {
        await admin.from('profiles').delete().eq('id', authUserId);
        await admin.auth.admin.deleteUser(authUserId);
        return json({ error: 'Account was rolled back because the member could not be linked: ' + linkErr.message }, 500);
      }

      return json({ ok: true, id: authUserId, email, phone, member_id: memberId, full_name: fullName, role });
    }

    if (action === 'reset_password') {
      const userId = String(body.user_id || '');
      const password = String(body.password || '');
      if (!userId) return json({ error: 'user_id is required.' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const userId = String(body.user_id || '');
      if (!userId) return json({ error: 'user_id is required.' }, 400);
      if (userId === user.id) return json({ error: 'You cannot delete your own account.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'set_role') {
      const targetId = String(body.user_id || '');
      const role = String(body.role || '');
      if (!targetId || !role) return json({ error: 'user_id and role are required.' }, 400);
      if (targetId === user.id) return json({ error: 'You cannot change your own role.' }, 400);
      const { data: roleDef } = await admin.from('role_catalog').select('role_key').eq('role_key', role).maybeSingle();
      if (!roleDef || role === 'pending') return json({ error: 'Invalid role.' }, 400);
      const { data: target } = await admin.from('profiles').select('role').eq('id', targetId).maybeSingle();
      if (!target) return json({ error: 'User not found.' }, 404);
      if ((role === 'super_admin' || target.role === 'super_admin') && me.role !== 'super_admin') return json({ error: 'Only a Super Admin can do this.' }, 403);
      const { data: updated, error } = await caller.from('profiles').update({ role }).eq('id', targetId).select('id');
      if (error) return json({ error: error.message }, 400);
      if (!updated?.length) return json({ error: 'The role was not changed (permission denied).' }, 403);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
