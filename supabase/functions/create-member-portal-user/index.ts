import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function normalizePhone(value: string) {
  const raw = String(value || '').trim().replace(/[\s()-]/g, '')
  if (raw.startsWith('+')) return raw
  if (raw.startsWith('233')) return '+' + raw
  if (raw.startsWith('0')) return '+233' + raw.slice(1)
  return raw
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const url = Deno.env.get('SUPABASE_URL') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) throw new Error('You must be signed in.')
    const { data: caller } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!caller || !['admin', 'secretary'].includes(caller.role)) throw new Error('Only administrators and secretaries can create member portal accounts.')

    const { member_id } = await req.json()
    if (!member_id) throw new Error('member_id is required.')
    const admin = createClient(url, service)
    const { data: member, error: memberError } = await admin.from('members').select('id,name,phone,email,user_id').eq('id', member_id).single()
    if (memberError || !member) throw new Error(memberError?.message || 'Member not found.')
    const phone = normalizePhone(member.phone || '')
    if (!phone || !/^\+233\d{9}$/.test(phone)) throw new Error('Enter a valid Ghanaian phone number for this member first.')

    const temporary_password = generatePassword()
    let authUserId = member.user_id || null
    if (authUserId) {
      const { error } = await admin.auth.admin.updateUserById(authUserId, { password: temporary_password, phone, phone_confirm: true })
      if (error) throw error
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({ phone, password: temporary_password, phone_confirm: true, user_metadata: { full_name: member.name, member_id: member.id } })
      if (error) throw error
      authUserId = created.user.id
    }

    await admin.from('profiles').upsert({ id: authUserId, full_name: member.name, role: 'member', member_id: member.id }, { onConflict: 'id' })
    const { error: linkError } = await admin.from('members').update({ user_id: authUserId, portal_enabled: true, portal_created_at: new Date().toISOString() }).eq('id', member.id)
    if (linkError) throw linkError

    return new Response(JSON.stringify({ ok: true, phone, temporary_password, member_id: member.id }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
