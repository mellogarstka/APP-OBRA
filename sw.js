// Service Worker — cache completo do app para funcionamento 100% offline.
// Ao publicar uma nova versão, altere VERSION: o cache antigo é descartado,
// mas os DADOS (IndexedDB) nunca são tocados pelo Service Worker.
const VERSION = 'obra-v1.1.0';
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
  'js/db.js',
  'js/fmt.js',
  'js/seed.js',
  'js/store.js',
  'js/ui.js',
  'js/views/config.js',
  'js/views/home.js',
  'js/views/item.js',
  'js/views/lists.js',
  'js/views/novo.js',
  'js/views/reports.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache primeiro (offline garantido); atualiza em segundo plano quando há rede.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(res => {
      if (res.ok) caches.open(VERSION).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit || caches.match('./index.html'));
    return hit || net;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(ws => ws[0] ? ws[0].focus() : self.clients.openWindow('./#/inicio')));
});
