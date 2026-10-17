import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), {
status,
headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async (req) => {
if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
if (req.method !== 'POST') return json({ error: 'Invalid request.' }, 405)

try {
const body = await req.json()
const memberCode = String(body?.member_code || '').trim().toUpperCase()
const password = typeof body?.password === 'string' ? body.password : ''


if (!memberCode || !password || memberCode.length > 80 || password.length > 1024) {
  return json({ error: 'Invalid registration number or password.' }, 400)
}

const url = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!url || !anonKey || !serviceKey) {
  return json({ error: 'Sign-in service is not configured.' }, 500)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: member, error: memberError } = await admin
  .from('members')
  .select('id,user_id,portal_enabled')
  .eq('member_code', memberCode)
  .eq('portal_enabled', true)
  .not('user_id', 'is', null)
  .maybeSingle()

if (memberError || !member?.user_id) {
  return json({ error: 'Registration number or password is incorrect, or portal access is not enabled.' }, 401)
}

const { data: authData, error: authLookupError } =
  await admin.auth.admin.getUserById(member.user_id)

const loginEmail = authData?.user?.email

if (authLookupError || !loginEmail) {
  return json({ error: 'Registration number or password is incorrect, or portal access is not enabled.' }, 401)
}

const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: login, error: loginError } =
  await anon.auth.signInWithPassword({ email: loginEmail, password })

if (loginError || !login.session?.access_token || !login.session?.refresh_token) {
  return json({ error: 'Registration number or password is incorrect, or portal access is not enabled.' }, 401)
}

return json({
  access_token: login.session.access_token,
  refresh_token: login.session.refresh_token,
})


} catch {
return json({ error: 'Sign-in could not be completed. Please try again.' }, 400)
}
})
