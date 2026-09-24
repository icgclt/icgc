import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_SECRET = Deno.env.get('NOTIFICATION_CRON_SECRET') || ''
const SMS_KEY = Deno.env.get('SMSONLINEGH_API_KEY') || ''
const SMS_SENDER = Deno.env.get('SMSONLINEGH_SENDER_ID') || ''
const WA_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || ''
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || ''
const WA_GRAPH_VERSION = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v23.0'
const MAX_ATTEMPTS = 5

const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function normalizePhone(value: unknown) {
  let s = String(value || '').replace(/[^\d+]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('0')) s = '233' + s.slice(1)
  else if (!s.startsWith('233')) s = '233' + s
  return s
}

async function callerAllowed(req: Request) {
  const supplied = req.headers.get('x-cron-secret') || ''
  if (CRON_SECRET && supplied && supplied === CRON_SECRET) return true
  const auth = req.headers.get('Authorization') || ''
  if (!auth) return false
  const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') || '', { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return false
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return ['admin', 'secretary'].includes(profile?.role)
}

async function sendSms(row: any) {
  if (!SMS_KEY || !SMS_SENDER) throw new Error('SMS provider is not configured.')
  const to = normalizePhone(row.phone)
  if (!/^233\d{9}$/.test(to)) throw new Error('Recipient phone number is not a valid Ghana number.')
  const form = new URLSearchParams({ key: SMS_KEY, text: String(row.message || ''), type: '0', sender: SMS_SENDER, to })
  const response = await fetch('https://api.smsonlinegh.com/v5/message/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString() })
  const rawText = await response.text()
  let raw: any = rawText
  try { raw = JSON.parse(rawText) } catch { /* keep text */ }
  if (!response.ok) throw new Error(raw?.message || raw?.error || `SMS provider returned ${response.status}`)
  return { provider: 'SMSOnlineGH', reference: String(raw?.message_id || raw?.id || raw?.reference || ''), payload: raw }
}

async function sendWhatsApp(row: any) {
  if (!WA_TOKEN || !WA_PHONE_ID) throw new Error('WhatsApp Cloud API is not configured.')
  const to = normalizePhone(row.phone)
  if (!/^233\d{9}$/.test(to)) throw new Error('Recipient phone number is not a valid Ghana number.')
  const url = `https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_ID}/messages`
  let payload: any
  if (row.whatsapp_template_name) {
    payload = { messaging_product: 'whatsapp', to, type: 'template', template: { name: row.whatsapp_template_name, language: { code: row.whatsapp_template_language || 'en_US' } } }
  } else {
    payload = { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: String(row.message || '') } }
  }
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const raw = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(raw?.error?.message || `WhatsApp provider returned ${response.status}`)
  return { provider: 'Meta WhatsApp', reference: String(raw?.messages?.[0]?.id || ''), payload: raw }
}

async function processRow(row: any) {
  const result = row.channel === 'SMS' ? await sendSms(row) : row.channel === 'WhatsApp' ? await sendWhatsApp(row) : null
  if (!result) throw new Error(`Channel ${row.channel} is not enabled by V17. Use SMS or WhatsApp.`)
  await admin.from('communication_queue').update({ status: 'Sent', provider: result.provider, provider_reference: result.reference || null, sent_at: new Date().toISOString(), last_error: null, provider_payload: result.payload, attempts: Number(row.attempts || 0) + 1 }).eq('id', row.id)
  await admin.from('notification_logs').insert({ id: crypto.randomUUID(), campaign_id: row.campaign_id || null, queue_id: row.id, member_id: row.member_id || null, channel: row.channel, destination: row.phone || row.email || null, status: 'Sent', provider: result.provider, provider_reference: result.reference || null, attempts: Number(row.attempts || 0) + 1, sent_at: new Date().toISOString(), provider_payload: result.payload })
  return { id: row.id, ok: true, provider: result.provider }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (!(await callerAllowed(req))) return json({ error: 'Not authorized.' }, 401)
    const body = await req.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body?.limit || 25), 1), 100)
    const now = new Date().toISOString()
    const { data: candidates, error } = await admin.from('communication_queue').select('*').in('status', ['Queued','Failed']).order('scheduled_for', { ascending: true }).limit(Math.min(limit * 2, 200))
    if (error) return json({ error: error.message }, 500)
    const nowMs = Date.now()
    const rows = (candidates || []).filter((row: any) => {
      const scheduledOk = !row.scheduled_for || new Date(row.scheduled_for).getTime() <= nowMs
      const retryOk = !row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= nowMs
      return scheduledOk && retryOk
    }).slice(0, limit)
    const results = []
    for (const row of rows) {
      const attempt = Number(row.attempts || 0)
      if (row.status === 'Failed' && attempt >= MAX_ATTEMPTS) continue
      const { data: claimed } = await admin.from('communication_queue').update({ status: 'Processing', attempts: attempt + 1 }).eq('id', row.id).in('status', ['Queued','Failed']).select('*').maybeSingle()
      if (!claimed) continue
      try {
        results.push(await processRow(claimed))
      } catch (e) {
        const message = String((e as any)?.message || e)
        const nextMinutes = [1,5,15,30,60][Math.min(attempt, 4)]
        await admin.from('communication_queue').update({ status: attempt + 1 >= MAX_ATTEMPTS ? 'Failed' : 'Queued', last_error: message, next_attempt_at: new Date(Date.now() + nextMinutes * 60000).toISOString() }).eq('id', row.id)
        await admin.from('notification_logs').insert({ id: crypto.randomUUID(), campaign_id: row.campaign_id || null, queue_id: row.id, member_id: row.member_id || null, channel: row.channel, destination: row.phone || row.email || null, status: 'Failed', provider: row.channel === 'SMS' ? 'SMSOnlineGH' : row.channel === 'WhatsApp' ? 'Meta WhatsApp' : null, error_message: message, attempts: attempt + 1 })
        results.push({ id: row.id, ok: false, error: message })
      }
    }
    return json({ ok: true, processed: results.length, results, message: `Processed ${results.length} message(s).` })
  } catch (e) { return json({ error: String((e as any)?.message || e) }, 500) }
})
