/**
 * ImWeb Service Worker
 * Cache-first strategy for app shell; network-first for anything else.
 */

// BUMP THIS ON EVERY REBUILD YOU NEED A DEVICE TO ACTUALLY PICK UP. The fetch
// handler is cache-first (`cached || network`), and `vite build` emits a NEW
// content hash for the bundle each time — so a stale cached index.html points
// at an asset that no longer exists on disk. That fails as a BLANK APP, not as
// "my change didn't show up" (see docs/LEARNED.md, 2026-07-31).
const CACHE = 'imweb-v0.14'; // bumped: resilient install, network-first docs

// The /src/* entries only exist on the DEV server; a production build bundles
// them into /assets/* under hashed names. That matters because addAll() is
// all-or-nothing — one 404 rejects the whole call, install fails, and the
// worker never activates. So this list is best-effort, not a manifest: cache
// what the current origin actually has and ignore the rest. Listing hashed
// asset names here is impossible anyway, and the fetch handler picks them up
// on first visit.
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
    caches.open(CACHE)
      .then(c => Promise.all(APP_SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
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

  // Documentation is NETWORK-FIRST, everything else cache-first.
  //
  // Cache-first is right for the shell and wrong for the manual: it served
  // whatever revision a reader happened to open once and never refreshed it, so
  // an edited manual could not reach anyone who had already read the old one.
  // Falls back to cache when offline, which is the case cache-first was for.
  const isDoc = url.pathname.startsWith('/docs/');

  // EVERY path below is wrapped. If the promise handed to respondWith() rejects,
  // the page's own fetch() throws a bare "Failed to fetch" — no status, no
  // message, indistinguishable from the server being down. caches.match() and
  // caches.open() can both reject (storage disabled, quota, private mode, a
  // cache deleted concurrently by a devtools "clear site data"), and neither was
  // guarded, so a storage hiccup surfaced as a phantom network failure.
  e.respondWith((async () => {
    const fromCache = async req => {
      try { return await caches.match(req); } catch { return undefined; }
    };
    const store = async (req, res) => {
      try { (await caches.open(CACHE)).put(req, res); } catch { /* quota, etc. */ }
    };
    const fromNetwork = async () => {
      const res = await fetch(e.request);
      if (res.status === 200) store(e.request, res.clone());
      return res;
    };
    const offline = () =>
      new Response('', { status: 504, statusText: 'Gateway Timeout' });

    if (isDoc) {
      try { return await fromNetwork(); }
      catch { return (await fromCache(e.request)) || offline(); }
    }

    const cached = await fromCache(e.request);
    if (cached) return cached;
    try { return await fromNetwork(); }
    catch (err) {
      console.warn('[SW] fetch failed for', e.request.url, err);
      return offline();
    }
  })());
});
