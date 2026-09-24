import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await anon.auth.getUser()
    if (!user) return json({ error: 'Authentication required.' }, 401)

    const body = await req.json()
    const requestId = body.request_id

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: profile } = await admin.from('profiles').select('role,member_id,email').eq('id', user.id).single()
    let request: any = null

    if (requestId) {
      const { data, error } = await admin.from('payment_requests').select('*').eq('id', requestId).single()
      if (error || !data) return json({ error: 'Payment request not found.' }, 404)
      request = data
      const allowed = ['admin','finance'].includes(profile?.role) || request.member_id === profile?.member_id
      if (!allowed) return json({ error: 'Not authorised for this payment request.' }, 403)
    } else {
      const amount = Number(body.amount)
      const memberId = body.member_id || profile?.member_id || null
      const allowed = ['admin','finance'].includes(profile?.role) || memberId === profile?.member_id
      if (!allowed || !amount || amount <= 0 || !body.phone || !body.provider || !body.fund) return json({ error: 'Invalid payment details.' }, 400)
      const { data: member } = memberId ? await admin.from('members').select('id,name,email,phone').eq('id', memberId).single() : { data: null }
      const id = crypto.randomUUID()
      const reference = `CHURCH-${id.replaceAll('-','').slice(0,18).toUpperCase()}`
      const { data, error } = await admin.from('payment_requests').insert({ id, member_id: memberId, member_name: member?.name || body.member_name || profile?.email || 'Anonymous', email: body.email || member?.email || profile?.email || '', phone: body.phone, provider: body.provider, amount, fund: body.fund, reference, status: 'Pending', metadata: { source: body.source || 'Portal' }, created_by: user.id }).select('*').single()
      if (error) return json({ error: error.message }, 400)
      request = data
    }
    if (request.status === 'Paid') return json({ status: 'Paid', reference: request.reference })

    const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
    if (!secret) return json({ error: 'PAYSTACK_SECRET_KEY is not configured in Supabase Edge Functions.' }, 500)

    const reference = request.reference || `CHURCH-${crypto.randomUUID().replaceAll('-','').slice(0,24)}`
    const amountSubunit = Math.round(Number(request.amount) * 100)
    const payload = {
      email: request.email || `${request.phone.replace(/\D/g,'')}@member.church.local`,
      amount: String(amountSubunit),
      currency: 'GHS',
      reference,
      metadata: { payment_request_id: request.id, member_id: request.member_id, fund: request.fund },
      mobile_money: { phone: request.phone, provider: request.provider }
    }
    const response = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const result = await response.json()
    if (!response.ok || !result.status) {
      await admin.from('payment_requests').update({ reference, status: 'Failed', failure_reason: result.message || 'Paystack charge failed' }).eq('id', request.id)
      return json({ error: result.message || 'Payment request failed.', reference }, 400)
    }

    const d = result.data || {}
    await admin.from('payment_requests').update({ reference, provider_reference: String(d.reference || reference), provider_status: d.status || 'pay_offline', display_message: d.display_text || 'Approve the payment on your mobile phone.', status: 'Processing' }).eq('id', request.id)
    return json({ status: 'Processing', reference: d.reference || reference, provider_status: d.status, display_message: d.display_text || 'Approve the payment on your mobile phone.' })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
