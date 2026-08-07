'use strict';

const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');

function mustContain(text, needle, label) {
  assert(text.includes(needle), `Missing ${label}: ${needle}`);
  console.log(`✓ ${label}`);
}

function mustNotContain(text, needle, label) {
  assert(!text.includes(needle), `Unexpected ${label}: ${needle}`);
  console.log(`✓ ${label}`);
}

mustContain(app, "APP_ASSET_VERSION = 'commercial-1-0-5-r31'", 'app asset version r29');
mustContain(sw, "CACHE = 'click360-commercial-1-0-5-r31'", 'service worker cache r29');
mustNotContain(app, "APP_ASSET_VERSION = 'commercial-1-0-5-r20'", 'stale app r20 removed');
mustNotContain(sw, "CACHE = 'click360-commercial-1-0-5-r28'", 'stale SW r28 removed');

mustContain(app, 'window.click360GetLocalBusinessSyncStats = localBusinessSyncStats', 'local sync stats bridge');
mustContain(app, 'if (localStats.meaningful === false)', 'empty-local automatic cloud recovery');
mustContain(app, "click360ResolveSyncConflict?.('refresh_cloud')", 'empty-local refresh action');
mustContain(app, 'Este dispositivo está vacío y no reemplazará los datos de la nube.', 'safe empty-local UX');

mustContain(firebase, 'blocked empty-local force write', 'firebase empty overwrite defense');
mustContain(firebase, "action: 'refresh_cloud_empty_local'", 'empty-local action classification');
mustContain(firebase, 'preventedEmptyOverwrite: true', 'empty overwrite audit signal');
mustContain(firebase, "pullRemoteOnce({ force: true, reload: false })", 'keep-local readback verification');
mustContain(firebase, "reason: 'manual_keep_local_failed'", 'failed keep-local remains blocking');

console.log('\nPHASE1_STABILITY_GUARDS: PASS');
