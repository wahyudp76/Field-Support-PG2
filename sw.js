/* Service Worker — Field Support Irigasi PG 2
 * - File aplikasi (HTML/CSS/JS): network-first → selalu versi terbaru, fallback cache saat offline
 * - Ikon & library CDN: cache-first (jarang berubah)
 * - Data Google Sheets: network-first, simpan salinan terakhir untuk mode offline */
const VERSION = 'fs-pg2-v5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './assets/css/style.css', './assets/js/config.js', './assets/js/data.js', './assets/js/app.js',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== VERSION + '-data').map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 1) Data spreadsheet → network-first (kunci cache dinormalisasi per sheet, abaikan parameter anti-cache)
  if (url.hostname === 'docs.google.com') {
    const key = url.origin + url.pathname + '?sheet=' + (url.searchParams.get('sheet') || '');
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(VERSION + '-data').then(c => c.put(key, r.clone())); return r; })
      .catch(() => caches.match(key).then(r => r || new Response('', { status: 503, statusText: 'Offline' }))));
    return;
  }
  // 2) Ikon & CDN → cache-first
  const isStatic = url.pathname.includes('/assets/icons/') || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('fonts.g');
  if (isStatic) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => { if (r.ok) caches.open(VERSION).then(x => x.put(e.request, r.clone())); return r; })));
    return;
  }
  // 3) Aplikasi (same-origin) → network-first, fallback cache (abaikan ?v= saat offline)
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) caches.open(VERSION).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
  }
});
