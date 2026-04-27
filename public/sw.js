/**
 * ImWeb Service Worker
 * Cache-first strategy for app shell; network-first for anything else.
 */

const CACHE = 'imweb-v0.5';

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
