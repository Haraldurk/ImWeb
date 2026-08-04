/**
 * ImWeb Service Worker
 * Cache-first strategy for app shell; network-first for anything else.
 */

// BUMP THIS ON EVERY REBUILD YOU NEED A DEVICE TO ACTUALLY PICK UP. The fetch
// handler is cache-first (`cached || network`), and `vite build` emits a NEW
// content hash for the bundle each time — so a stale cached index.html points
// at an asset that no longer exists on disk. That fails as a BLANK APP, not as
// "my change didn't show up" (see docs/LEARNED.md, 2026-07-31).
const CACHE = 'imweb-v0.10'; // bumped: per-deck upload counters in telemetry rows

const APP_SHELL = [
  '/',
  '/index.html',
  '/src/main.js',
  '/src/style.css',
  '/src/core/Pipeline.js',
  '/src/controls/ParameterSystem.js',
  '/src/controls/ControllerManager.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only handle same-origin GET requests
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // Bypass project files entirely — large, fetched once (first-launch
  // MasterProject load or explicit restore), no benefit from SW caching,
  // and routing them through an installing/activating worker risked
  // stalling the very fetch first-launch depends on.
  if (url.pathname.startsWith('/Projects/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(err => {
        console.warn('[SW] fetch failed for', e.request.url, err);
        return new Response('', { status: 504, statusText: 'Gateway Timeout' });
      });
      return cached || network;
    })
  );
});
