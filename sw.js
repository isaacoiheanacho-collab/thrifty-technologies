const CACHE_NAME = 'rosca-v5';
const PRECACHE = ['/', '/index.html', '/assets/css/base.css', '/assets/css/tokens.css'];

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1. API calls: never intercept. Let network errors propagate.
  if (url.pathname.startsWith('/api/')) return;

  // 2. Navigations (page loads): network-first with a fast timeout.
  //    If the network isn't ready, return a real 503 instead of undefined,
  //    so the browser does NOT fall back to the landing page.
  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNav) {
    e.respondWith((async () => {
      try {
        return await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;

        // If we don't have this page cached, tell the browser the network
        // is unavailable — do NOT serve the landing page in its place.
        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"><title>Reconnecting…</title></head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#0b0e11;color:#e1e3e5"><h1>Reconnecting…</h1><p>Waiting for network. This page will reload automatically.</p><script>setTimeout(function(){location.reload()},1500);</script></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
      }
    })());
    return;
  }

  // 3. Static assets: stale-while-revalidate.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.json') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const net = fetch(req).then(r => {
        if (r && r.ok) cache.put(req, r.clone()).catch(() => {});
        return r;
      }).catch(() => null);
      if (cached) return cached;
      const r = await net;
      return r || new Response('', { status: 504 });
    })());
    return;
  }
});