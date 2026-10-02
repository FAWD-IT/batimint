/*
 * Service worker de la vue terrain (ADR 0014). Portée : /terrain.
 * - pages /terrain : réseau d'abord, copie en cache pour rouvrir l'app sans réseau ;
 * - fichiers /_next/static (noms versionnés) : cache d'abord ;
 * - API : jamais mise en cache ici (la journée et la file hors ligne vivent dans IndexedDB).
 */
const VERSION = 'terrain-v2';
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const SHELL = ['/terrain', '/terrain/planning', '/terrain/heures', '/terrain/profil'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) =>
        Promise.all(
          SHELL.map((url) => cache.add(new Request(url, { credentials: 'include' })).catch(() => undefined)),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.pathname.startsWith('/terrain')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((cache) => cache.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .open(PAGES)
            .then((cache) => cache.match(url.pathname).then((hit) => hit || cache.match('/terrain'))),
        )
        .then((res) => res || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/terrain/icon-')) {
    event.respondWith(
      caches.open(STATIC).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            }),
        ),
      ),
    );
  }
});
