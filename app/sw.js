// Service worker v2: cachet de app-schil (offline opstarten), bezochte
// basiskaart-tegels (laatst bekeken gebied blijft zichtbaar) en de statische
// Lorenz-atlastegels (Bortle offline). Data-API's en radar blijven bewust
// netwerk-only; het app-niveau bewaart daarvoor snapshots met tijdstempel.
const CACHE = 'getijden-shell-v2';
const TILES = 'getijden-tiles-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];
const TILE_HOSTS = ['basemaps.cartocdn.com', 'server.arcgisonline.com', 'djlorenz.github.io'];
const MAX_TILES = 350;

self.addEventListener('install', e => {
  // per item cachen: één mislukte URL mag de installatie niet blokkeren
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function trimTiles(c){
  const keys = await c.keys();
  if (keys.length > MAX_TILES)
    for (const k of keys.slice(0, 60)) await c.delete(k);
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))){
    // tegels en atlas: cache-first (statisch), netwerk vult de cache
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque'){ c.put(e.request, res.clone()); trimTiles(c); }
      return res;
    }));
    return;
  }
  const isShell = SHELL.some(s => e.request.url.endsWith(s.replace('./', '/')) || e.request.url === s) ||
                  e.request.mode === 'navigate';
  if (!isShell) return; // data-API's: gewoon netwerk
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
