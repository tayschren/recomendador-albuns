// SPINREC Service Worker — v1
// Caches o shell do app para funcionamento offline

const CACHE_NAME = 'spinrec-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap'
];

// Install: cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can; don't fail install if a resource is unavailable
      return Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API calls, cache-first for shell
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network for API calls
  const isAPI = ['ws.audioscrobbler.com', 'musicbrainz.org', 'api.spotify.com', 'accounts.spotify.com'].some(h => url.hostname.includes(h));
  if(isAPI || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful same-origin + fonts
        if(response.ok && (url.origin === self.location.origin || url.hostname.includes('fonts'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', {status: 503}));
    })
  );
});
