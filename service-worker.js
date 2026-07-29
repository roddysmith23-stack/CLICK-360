const CACHE = 'click360-commercial-1-0-5-r2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './runtime-guard.js',
  './app.js',
  './firebase-config.js',
  './p0-tenant-guard.js',
  './v16-domain.js',
  './v16-storage.js',
  './access-flow.js',
  './firebase-service.js',
  './printing-service.js',
  './smart-print-core.js',
  './p2-web-safe-flags.js',
  './universal-label-canvas.js',
  './universal-label-editor.js',
  './manifest.webmanifest',
	'./robots.txt',
	'./sitemap.xml',
  './vendor/qrcode-generator.js',
  './vendor/jsbarcode.min.js',
  './vendor/jsQR.js',
  './vendor/zxing-browser.min.js',
	'./vendor/lucide.min.js',
  './vendor/html2pdf.bundle.min.js',
  './vendor/html2canvas.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
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
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('click360-') && key !== CACHE)
    .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        return caches.open(CACHE)
          .then(cache => cache.put('./index.html', copy))
          .catch(() => {})
          .then(() => response);
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === location.origin) {
    const freshAsset = ['script', 'style', 'worker', 'manifest'].includes(request.destination)
      || /\.(?:js|css|webmanifest)$/i.test(url.pathname);
    if (freshAsset) {
      event.respondWith(
        fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            return caches.open(CACHE)
              .then(cache => cache.put(request, copy))
              .catch(() => {})
              .then(() => response);
          }
          return response;
        }).catch(() => caches.match(request, { ignoreSearch: true }))
      );
      return;
    }

    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(match => {
        if (match) return match;
        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            return caches.open(CACHE)
              .then(cache => cache.put(request, copy))
              .catch(() => {})
              .then(() => response);
          }
          return response;
        });
      })
    );
    return;
  }

  // Auth, Firestore, and any other cross-origin request must stay network-only.
  // Caching them risks preserving authenticated responses beyond their session.
  event.respondWith(fetch(request));
});
