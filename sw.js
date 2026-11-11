const CACHE_NAME = 'rosca-v8';
const PRECACHE = ['/assets/css/base.css', '/assets/css/tokens.css'];

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'ROSCA Thrift';
  const options = {
    body: payload.body || 'You have a new update.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.metadata && payload.metadata.id ? String(payload.metadata.id) : 'rosca-notification',
    data: { url: payload.url || '/notifications' },
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/saver/dashboard.html', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"><title>Reconnecting…</title></head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;background:#0b0e11;color:#e1e3e5"><h1>Reconnecting…</h1><p>Waiting for network. This page will reload automatically.</p><script>setTimeout(function(){location.reload()},1500);</script></body></html>',
          {status:503,headers:{'Content-Type':'text/html'}}
        );
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.json') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const net = fetch(req).then(r => {
        if (r && r.ok) cache.put(req,r.clone()).catch(() => {});
        return r;
      }).catch(() => null);
      if (cached) return cached;
      const r = await net;
      return r || new Response('',{status:504});
    })());
  }
});