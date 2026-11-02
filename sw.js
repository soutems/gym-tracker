// Offline support: the app files are served from the cache and refreshed in the
// background (a new version shows up on the next launch). Exercise images are
// cached the first time they are seen.
const APP_CACHE = 'gym-app-v1';
const IMG_CACHE = 'gym-img-v1';
const APP_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'exercises.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Stale-while-revalidate, ignoring ?query so "./?x" still hits the cache
    ev.respondWith(caches.open(APP_CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    }));
    return;
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    // Cache-first; fetched with CORS so the cached copy is not an opaque response
    ev.respondWith(caches.open(IMG_CACHE).then(async cache => {
      const cached = await cache.match(req.url);
      if (cached) return cached;
      const res = await fetch(req.url, { mode: 'cors' });
      if (res.ok) cache.put(req.url, res.clone()).catch(() => {});
      return res;
    }));
  }
});
