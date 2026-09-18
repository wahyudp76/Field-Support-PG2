/* Service Worker — Field Support Irigasi PG 2
 * Strategi: app shell = cache-first (update di latar), data Google Sheets = network-first dengan fallback cache (offline). */
const VERSION = 'fs-pg2-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/style.css', './assets/js/config.js', './assets/js/data.js', './assets/js/app.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Data spreadsheet: network-first
  if (url.hostname === 'docs.google.com') {
    const key = url.origin + url.pathname + '?sheet=' + (url.searchParams.get('sheet') || '');
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION + '-data').then(c => c.put(key, cp)); return r; })
      .catch(() => caches.match(key).then(r => r || new Response('', { status: 503 }))));
    return;
  }
  // App shell: stale-while-revalidate
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(cached => {
    const net = fetch(e.request).then(r => { if (r.ok && (url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net')) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; }).catch(() => cached);
    return cached || net;
  }));
});
