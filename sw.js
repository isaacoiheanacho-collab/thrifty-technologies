/**
 * ROSCA Service Worker
 *
 * Strategy:
 *   - API requests (/api/*) are NEVER intercepted. They always go straight
 *     to the network so that api.js can distinguish a network failure from
 *     a real server response.
 *   - Navigations use network-first, falling back to a cached shell only
 *     when the network is truly unreachable (and only for known dashboards
 *     and the landing page).
 *   - Static assets use stale-while-revalidate.
 *   - The cache version is bumped every time ASSETS changes so old broken
 *     caches from previous deployments are wiped on activate.
 */

const CACHE_NAME = 'rosca-v3'; // bumped — wipes v2's broken cache

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/assets/css/base.css',
  '/assets/css/tokens.css',
];

// Shells that are safe to serve offline. Do NOT add dashboards here — they
// need live data on boot, and a stale shell leads to confusing UX.
const NAVIGATION_FALLBACK = '/index.html';

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Only GET can be cached. Everything else goes straight to the network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only. Cross-origin (fonts, socket.io) is handled by the
  // browser and by api.js's network-retry logic.
  if (url.origin !== self.location.origin) return;

  // ── 1. API calls: NEVER intercept ─────────────────────────
  // If we let the SW handle these, a network failure becomes a fake
  // "response" that api.js treats as an HTTP error (401/500) instead of a
  // true TypeError. That was causing the logout-on-wake-up bug.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it, no respondWith
  }

  // ── 2. Navigations: network-first, fallback to cached shell ─
  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    e.respondWith(handleNavigation(req));
    return;
  }

  // ── 3. Static assets: stale-while-revalidate ──────────────
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/sw.js'
  ) {
    e.respondWith(handleStatic(req));
    return;
  }

  // ── 4. Everything else: straight through, no caching ──────
  // Falling back to cache for arbitrary paths returns `undefined` and
  // masks network errors. Let the browser handle failures naturally.
  return;
});

// ── Handlers ─────────────────────────────────────────────────
async function handleNavigation(req) {
  try {
    // Try the network first with a short timeout so wake-up doesn't hang.
    const networkResp = await withTimeout(fetch(req), 4000);
    // Cache the freshly-fetched HTML for offline use later.
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, networkResp.clone()).catch(() => {});
    return networkResp;
  } catch (_) {
    // Network is unreachable. Only fall back to the offline shell if the
    // request is for a known page. Otherwise, serve the offline fallback.
    const cached = await caches.match(req);
    if (cached) return cached;
    const fallback = await caches.match(NAVIGATION_FALLBACK);
    if (fallback) return fallback;
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function handleStatic(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then(resp => {
      if (resp && resp.ok) {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    })
    .catch(() => null);

  // Serve from cache immediately if we have it; refresh in background.
  if (cached) return cached;

  const networkResp = await networkPromise;
  if (networkResp) return networkResp;

  return new Response('', { status: 504, statusText: 'Gateway Timeout' });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      err => { clearTimeout(t); reject(err); }
    );
  });
}