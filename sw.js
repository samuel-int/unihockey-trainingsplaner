// Service Worker: App-Dateien offline verfügbar machen (Netz zuerst, Cache als Rückfall).
const CACHE = 'utp-app-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'data-rtp.js', 'data-goalie.js', 'qrcode.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Netz zuerst (max. 2.5 s), sonst Cache: online immer aktuell, offline sofort nutzbar.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
    if (!hit) return net;
    return Promise.race([net, new Promise(r => setTimeout(() => r(hit), 2500))]).catch(() => hit);
  }));
});
