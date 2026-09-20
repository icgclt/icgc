// Offline shell: the app itself loads without internet. Data caching is handled inside the app (src/data.jsx).
const CACHE = 'church-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
const put = (req, res) => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return res; };

// Pages: network first (so updates arrive), but fall back to cache after 3s so slow links don't hang.
async function page(req) {
  const net = fetch(req).then((res) => put(req, res));
  try { return await Promise.race([net, timeout(3000)]); }
  catch (_) {
    const cached = (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
    return cached || net;
  }
}

// Built assets have hashed file names, so cache-first is safe.
async function asset(req) {
  const hit = await caches.match(req);
  return hit || fetch(req).then((res) => put(req, res));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // never touch Supabase API calls
  e.respondWith(req.mode === 'navigate' ? page(req) : asset(req));
});
