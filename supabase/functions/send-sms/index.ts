// Supabase Edge Function: send-sms
//
// Keeps the SMSOnlineGH API key on the server. The browser never sees it — it only
// calls this function (via supabase.functions.invoke), which checks the caller is
// signed in and has an allowed role, then forwards the request to SMSOnlineGH.
//
// Deploy:
//   supabase functions deploy send-sms
// Set secrets once (values from your SMSOnlineGH account):
//   supabase secrets set SMSONLINEGH_API_KEY=xxxx SMSONLINEGH_SENDER_ID=YourChurch
//
// NOTE: the exact field names SMSOnlineGH expects in the JSON body below (key, sender,
// destinations, message) are based on their published endpoint and common conventions
// for this API, but were not confirmed against your specific account's docs. After your
// first real send, check the "raw" field in the response this function returns — if
// SMSOnlineGH complains about a field name, log into your SMSOnlineGH dashboard's API/
// developer page for the exact sample request and adjust the `body` object below to match.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SMS_KEY = Deno.env.get('SMSONLINEGH_API_KEY');
const SMS_SENDER = Deno.env.get('SMSONLINEGH_SENDER_ID');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Normalizes Ghanaian numbers to 233XXXXXXXXX regardless of how they were typed
// (0244..., 244..., +233244..., 233244...).
function normalize(n) {
  let s = String(n).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '233' + s.slice(1);
  else if (!s.startsWith('233')) s = '233' + s;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: 'Not signed in.' }, 401);

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!profile || !['admin', 'secretary'].includes(profile.role)) {
      return json({ error: 'You do not have permission to send SMS.' }, 403);
    }

    if (!SMS_KEY || !SMS_SENDER) return json({ error: 'SMS is not configured yet — ask an admin to set the SMSOnlineGH secrets.' }, 500);

    const { recipients, message } = await req.json();
    if (!Array.isArray(recipients) || !recipients.length) return json({ error: 'No recipients provided.' }, 400);
    if (!message || !String(message).trim()) return json({ error: 'Message is empty.' }, 400);

    const numbers = [...new Set(recipients.map(normalize).filter((n) => n.length >= 12))];
    if (!numbers.length) return json({ error: 'None of the selected members have a usable phone number.' }, 400);

    const resp = await fetch('https://api.smsonlinegh.com/v4/message/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: SMS_KEY,
        sender: SMS_SENDER,
        destinations: numbers,
        message: String(message).trim(),
      }),
    });
    const raw = await resp.json().catch(() => ({}));
    if (!resp.ok) return json({ error: raw?.message || 'SMSOnlineGH rejected the request — see raw for details.', raw }, 502);

    return json({ ok: true, sent: numbers.length, raw });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
