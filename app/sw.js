// Service worker: cachet de app-schil zodat de app offline opstart.
// Data (getij, radar, kaarttegels) blijft bewust netwerk-only — die veroudert.
const CACHE = 'getijden-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  // per item cachen: één mislukte URL mag de installatie niet blokkeren
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  const isShell = SHELL.some(s => url.endsWith(s.replace('./', '/')) || url === s) ||
                  e.request.mode === 'navigate';
  if (!isShell) return; // data & tegels: gewoon netwerk
  // netwerk eerst (verse schil), cache als fallback (offline start)
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('./index.html'))
    )
  );
});
