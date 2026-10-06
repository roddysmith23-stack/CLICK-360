// 2026-10-01 P0 SHARY local-save hotfix: content stamp intentionally changes
// the Service Worker bytes so installed PWAs fetch and pre-cache the corrected
// app.js without changing the already-certified R38 cache/version contract.
const CACHE = 'click360-commercial-1-0-5-r38-mvp-candidate';
// Build tooling stamps a separate, immutable asset cache for each release.
// Development keeps the existing cache/network policy below.
const RELEASE_SHA = '__CLICK360_SW_BUILD_SHA__';
const RELEASE_CACHE = RELEASE_SHA.startsWith('__') ? CACHE : `${CACHE}-${RELEASE_SHA}`;
self.addEventListener('message', event => {
  if (event.data?.type === 'CLICK360_RELEASE_STATUS') {
    event.source?.postMessage({ type:'CLICK360_RELEASE_STATUS', buildSha:RELEASE_SHA, cache:RELEASE_CACHE });
  }
});
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './runtime-guard.js',
  './safe-update.js',
  './app.js',
  './firebase-config.js',
  './p0-tenant-guard.js',
  './worker-data-boundary.js',
  './v16-domain.js',
  './tenant-quota-overrides.js',
  './v16-storage.js',
  './cloud-safety-backup.js',
  './cloud-safety-backup-client.js',
  './access-flow.js',
  './firebase-service.js',
  './printing-service.js',
  './smart-print-core.js',
  './p2-web-safe-flags.js',
  './p2-restaurant-domain.js',
  './p2-logistics-domain.js',
  './cash-session-reconciliation.js',
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
  event.waitUntil((async () => {
    const cache = await caches.open(RELEASE_CACHE);
    if (RELEASE_CACHE === CACHE) await cache.addAll(ASSETS);
    else {
      const manifestResponse = await fetch('./release-manifest.json', { cache:'no-store' });
      if (!manifestResponse.ok) throw new Error('Release manifest unavailable');
      const manifest = await manifestResponse.json();
      if (manifest.buildSha !== RELEASE_SHA || !manifest.assetHashes) throw new Error('Release identity mismatch');
      // Never activate a partially downloaded or mixed release.
      await Promise.all(ASSETS.map(async path => {
        const response = await fetch(path, { cache:'no-store' });
        if (!response.ok) throw new Error('Asset unavailable: ' + path);
        const key = path === './' ? 'index.html' : path.slice(2);
        const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== manifest.assetHashes[key]) throw new Error('Asset identity mismatch: ' + key);
        await cache.put(path, response);
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  // Retain earlier versioned caches: an already-open old client must not lose
  // its offline shell during activation. User data stores are never touched.
  if (RELEASE_CACHE !== CACHE) { event.waitUntil(self.clients.claim()); return; }
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('click360-') && key !== CACHE)
    .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const url = new URL(request.url);

  // P0-2 (SHARY laptop black screen, Track A): /repair.html is the
  // independent rescue path -- it must never depend on this worker (or on
  // whatever bundle/state this worker happens to be serving). Let it fall
  // through to a completely normal, uncontrolled network request.
  // r37.1 (P0-A safe update): release-manifest.json is repair.html's
  // network-reachability probe -- it must reflect the REAL, current network
  // state (a stale/broken worker answering from its own cache would defeat
  // the entire point of the check), so it gets the same bypass.
  if (url.pathname.endsWith('/repair.html') || url.pathname.endsWith('/release-manifest.json')) return;

  if (RELEASE_CACHE !== CACHE && url.origin === location.origin) {
    event.respondWith(caches.open(RELEASE_CACHE).then(async cache => {
      const match = await cache.match(request, { ignoreSearch:true });
      if (match) return match;
      if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname.endsWith('/index.html'))) {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return fetch(request);
    }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        // Cache under the ACTUAL requested URL, not a hardcoded './index.html'.
        // The previous hardcoded key meant navigating to ANY page other than
        // '/' (this worker previously only ever saw '/') would silently
        // overwrite the cached app shell with that other page's content --
        // latent until /repair.html gave the app a second real navigable URL.
        return caches.open(CACHE)
          .then(cache => cache.put(request, copy))
          .catch(() => {})
          .then(() => response);
      }).catch(() => caches.match(request).then((match) => match || caches.match('./index.html')))
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
