/* Service worker minimo: la pagina si apre anche senza rete (con l'ultima copia) e si aggiorna sempre da rete quando c'e'.
   I dati (/api/...) non si salvano mai: devono essere sempre freschi. */
const CACHE = 'betting-crm-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/app.html', '/icon-192.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;      // dati e azioni: sempre dalla rete
  e.respondWith(fetch(e.request).then(r => { if (r.ok && (u.pathname === '/app.html' || u.pathname.endsWith('.png'))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('/app.html'))));
});
