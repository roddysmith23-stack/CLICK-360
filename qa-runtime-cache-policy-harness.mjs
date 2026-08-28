import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, firebaseService, index, runtimeGuard, worker, manifest, releaseManifest, firebaseConfig] = await Promise.all([
  readFile('app.js', 'utf8'),
  readFile('firebase-service.js', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('runtime-guard.js', 'utf8'),
  readFile('service-worker.js', 'utf8'),
  readFile('manifest.webmanifest', 'utf8').then(JSON.parse),
  readFile('release-manifest.json', 'utf8').then(JSON.parse),
  readFile('firebase.json', 'utf8').then(JSON.parse)
]);

const assetVersion = app.match(/const APP_ASSET_VERSION = '([^']+)'/)?.[1];
assert.ok(assetVersion, 'app.js must define an asset version');
assert.ok(firebaseService.includes(`const APP_ASSET_VERSION = '${assetVersion}'`), 'firebase-service version must match app');
assert.ok(runtimeGuard.includes(`const ASSET_VERSION = '${assetVersion}'`), 'runtime guard version must match app');
assert.ok(worker.includes(`const CACHE = 'click360-${assetVersion}'`), 'service worker cache must match app');
assert.equal(manifest.start_url, `./?v=${assetVersion}`, 'PWA start URL must match app');
assert.equal(releaseManifest.version, assetVersion, 'release manifest must match app');

for (const rootAsset of ['runtime-guard.js', 'styles.css', 'p0-tenant-guard.js', 'v16-domain.js', 'firebase-service.js', 'app.js']) {
  assert.ok(index.includes(`${rootAsset}?v=${assetVersion}`), `${rootAsset} URL must use current asset version`);
}

const headers = firebaseConfig.hosting?.headers || [];
const headerValue = (source) => headers.find((entry) => entry.source === source)?.headers?.find((header) => header.key === 'Cache-Control')?.value || '';
assert.equal(headerValue('/*.js'), 'no-cache, must-revalidate', 'root JavaScript must revalidate');
assert.equal(headerValue('/*.css'), 'no-cache, must-revalidate', 'root CSS must revalidate');
assert.equal(headerValue('/service-worker.js'), 'no-cache, no-store, must-revalidate', 'service worker must never be cached');
assert.match(headerValue('/assets/**'), /immutable/, 'static assets remain immutable');
assert.match(headerValue('/vendor/**'), /immutable/, 'vendor assets remain immutable');

console.log(`qa-runtime-cache-policy-harness: PASS (${assetVersion})`);
