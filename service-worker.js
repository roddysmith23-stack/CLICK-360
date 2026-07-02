const CACHE = 'click360-mvp-final-offline-safe-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase-config.js',
  './firebase-service.js',
  './manifest.webmanifest',
  './vendor/qrcode-generator.js',
  './vendor/jsQR.js',
  './assets/favicon.ico',
  './assets/favicon.png',
  './assets/logo.png',
  './assets/banner-click360-home.png',
  './assets/banner-motivacional.png',
  './assets/icon-16.png',
  './assets/icon-32.png',
  './assets/icon-48.png',
  './assets/icon-64.png',
  './assets/icon-128.png',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-256.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(() => {});
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(match => {
        if (match) return match;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(match => match || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
      return response;
    }))
  );
});
