import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function hmacHex(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2,'0')).join('')
}

Deno.serve(async (req) => {
  try {
    const raw = await req.text()
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
    const signature = req.headers.get('x-paystack-signature') || ''
    if (!secret || !signature || signature !== await hmacHex(secret, raw)) return json({ error: 'Invalid signature.' }, 401)

    const event = JSON.parse(raw)
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const d = event.data || {}
    const providerRef = d.reference ? String(d.reference) : null
    const { data: inserted } = await admin.from('payment_webhook_events').insert({ event_type: event.event, provider_reference: providerRef, payload: event }).select('id').maybeSingle()

    if (event.event === 'charge.success' && providerRef) {
      const { data: request } = await admin.from('payment_requests').select('*').eq('provider_reference', providerRef).maybeSingle()
      if (request && request.status !== 'Paid') {
        const paidAt = d.paid_at || new Date().toISOString()
        await admin.from('payment_requests').update({ status: 'Paid', provider_status: d.status || 'success', paid_at: paidAt, failure_reason: null }).eq('id', request.id)
        const receiptNumber = `MM-${providerRef}`
        await admin.from('payment_receipts').upsert({ member_id: request.member_id, member_name: request.member_name, amount: request.amount, fund: request.fund, method: 'Mobile Money', provider: 'Paystack', reference: providerRef, receipt_number: receiptNumber, status: 'Paid', paid_at: paidAt, notes: 'Automatic Paystack mobile money payment' }, { onConflict: 'receipt_number' })
        await admin.from('giving').insert({ id: crypto.randomUUID(), date: paidAt.slice(0,10), giver: request.member_name, member_id: request.member_id, type: request.fund === 'Tithe' ? 'Tithe' : request.fund === 'Pledge' ? 'Pledge' : request.fund === 'Donation' ? 'Donation' : 'Offering', amount: request.amount, method: 'Mobile Money', reference: providerRef, created_by: request.created_by })
        await admin.from('payment_webhook_events').update({ processed: true }).eq('id', inserted?.id || '')
      }
    }
    return json({ received: true })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
