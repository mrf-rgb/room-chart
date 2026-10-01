// Offline shell: the app files are cached; Google sign-in, Picker and Drive calls always go to the network.
const CACHE = 'room-chart-1.0.6';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/model.js', 'js/chart.js', 'js/store.js', 'js/drive.js', 'js/config.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'sample/sample-data.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so an update shows on the next open; the cache answers when offline.
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
