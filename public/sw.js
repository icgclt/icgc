// Service worker: keeps the app shell available offline.
// It only handles same-origin GET requests. Supabase, Paystack and SMS calls are
// cross-origin and are never intercepted, so data always goes through the app's own sync logic.
// Bump VERSION to force every device to drop its old cache.
const VERSION = 'cm-shell-v1';
const SHELL = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png', './icgc-logo.png'];
const MAX_ENTRIES = 80;       // hashed build files pile up across deploys; trim the oldest
const NAV_TIMEOUT_MS = 4000;  // on a weak connection, fall back to the saved shell instead of hanging

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function handleNavigation(request) {
  const cache = await caches.open(VERSION);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAV_TIMEOUT_MS);
  try {
    const res = await fetch(request, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch {
    clearTimeout(timer);
    return (await cache.match('./index.html')) || Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') { cache.put(request, res.clone()).then(() => trim(cache)); }
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? handleNavigation(request) : handleAsset(request));
});
