// Service Worker — cache completo do app para funcionamento 100% offline.
// Ao publicar uma nova versão, altere VERSION: o cache antigo é descartado,
// mas os DADOS (IndexedDB) nunca são tocados pelo Service Worker.
const VERSION = 'obra-v1.5.0';
const ASSETS = [
  './',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'index.html',
  'js/actions.js',
  'js/app.js',
  'js/calc.js',
  'js/config.js',
  'js/db.js',
  'js/fmt.js',
  'js/seed.js',
  'js/store.js',
  'js/sync.js',
  'js/ui.js',
  'js/vendor/supabase-2.119.0.js',
  'js/views/config.js',
  'js/views/home.js',
  'js/views/item.js',
  'js/views/lists.js',
  'js/views/novo.js',
  'js/views/reports.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → baixa do servidor, nunca do cache HTTP do navegador (evita gravar arquivo antigo na versão nova)
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Rede primeiro (com limite de 3 s): online, sempre a versão mais recente; offline, a cópia guardada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const rede = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    const limite = new Promise(r => setTimeout(r, 3000));
    try {
      const res = await Promise.race([rede, limite.then(() => null)]);
      if (res) return res;
    } catch { /* sem rede */ }
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try { return await rede; } catch { return (await cache.match('./index.html')) || Response.error(); }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(ws => ws[0] ? ws[0].focus() : self.clients.openWindow('./#/inicio')));
});
