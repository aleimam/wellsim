/* WellSim service worker — makes the app installable and usable offline.
 *
 * The strategy is chosen around one hard constraint: the app is versioned by
 * an ASSET STAMP in index.html (app.js?v=YYYY-MM-DDx). A service worker that
 * cached HTML aggressively would serve an old index.html forever, pinning
 * users to an old bundle and defeating the stamp entirely — the worst failure
 * a PWA can have on a tool whose numbers must be current.
 *
 *   navigation / HTML  -> NETWORK FIRST, cache only as an offline fallback
 *   versioned statics  -> CACHE FIRST (the stamp changes the URL, so a new
 *                         build simply misses the cache and fetches)
 *   /api/*             -> NEVER cached; a stale reservoir answer is worse
 *                         than no answer
 *
 * CACHE_VERSION must match the asset stamp in index.html; tests/docs.test.js
 * asserts that, so the two cannot drift.
 */
const CACHE_VERSION = '2026-09-03b';
const CACHE = `wellsim-${CACHE_VERSION}`;

// Enough to boot offline. Plotly is added on first fetch rather than listed,
// since it is a cross-origin CDN response.
const PRECACHE = [
  '/',
  '/app.js',
  '/export.js',
  '/style.css',
  '/help.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  // addAll rejects the whole install if ANY entry 404s, which would leave the
  // app with no worker at all — add individually and tolerate misses.
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // never serve a cached calculation, and never cache one
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // HTML: network first so a new deploy is picked up immediately
  const isDoc = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // everything else: cache first, then fill the cache behind the response
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // opaque cross-origin responses (the Plotly CDN) are cacheable and
          // worth keeping — without them the charts do not draw offline
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
