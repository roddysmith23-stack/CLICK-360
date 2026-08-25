/**
 * r37.1 (P0-A, real SHARY evidence): "actualizar archivos" left a customer
 * with NO working app. repair.html used to unregister the service worker
 * and delete every cache BEFORE ever confirming a new version could be
 * downloaded -- a network drop or server hiccup at that exact moment meant
 * the customer had nothing left to open.
 *
 * r37.2.1 (LIVE CLIENT RECOVERY, a SECOND real SHARY incident): r37.1 only
 * fixed repair.html. Two OTHER user-facing "update" buttons -- the access
 * gate's "Actualizar archivos de la app" and the boot-recovery screen's
 * "Actualizar aplicacion" -- still had their OWN separate, destroy-first
 * copies. The engine now lives ONCE, in safe-update.js, and every
 * user-facing update entry point (repair.html, the access gate, the
 * boot-recovery screen) is a thin wrapper around the SAME
 * window.click360SafeUpdate(). This harness locks that in structurally;
 * qa/r36-repair-rescue-path-e2e.mjs, qa/r37-1-offline-safe-update-e2e.mjs
 * and qa/r37-2-1-safe-update-all-entrypoints-e2e.mjs prove it live.
 */
const assert = require('assert');
const fs = require('fs');

const engine = fs.readFileSync('safe-update.js', 'utf8');
const repair = fs.readFileSync('repair.html', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const firebaseService = fs.readFileSync('firebase-service.js', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const buildScript = fs.readFileSync('scripts/build-static-release.mjs', 'utf8');

// ── The engine itself: PREPARE -> COMMIT -> ROLLBACK, real and complete. ──
assert(engine.includes('root.click360SafeUpdate = function'), 'safe-update.js must expose a single shared window.click360SafeUpdate() engine');
assert(engine.includes('if (!navigator.onLine)'), 'the engine must check navigator.onLine first and refuse to touch anything while offline');
assert(engine.includes('release-manifest.json'), 'the engine must fetch a real, current release manifest to prove the server is actually reachable before attempting an update');
assert(/fetch\('\.\/release-manifest\.json[\s\S]{0,40}\{\s*cache:\s*'no-store'\s*\}\)/.test(engine), 'the manifest reachability probe must bypass HTTP cache (cache: "no-store") -- a cached 200 would defeat the entire point of the check');
assert(engine.includes('waitForActiveWorker'), 'the engine must wait for a real, confirmed-active worker before considering the update successful');
assert(engine.includes('existingReg.update()'), 'the engine must drive an update through the real registration.update() API -- the browser-native atomic install path -- not a manual unregister/re-register dance');
assert(engine.includes('UPDATE_TIMEOUT_MS'), 'the update attempt must be bounded by a timeout so a hung install can still fall back to rollback instead of leaving the user stuck forever');
assert(!/unregister\(\)/.test(engine) && !/caches\.delete\(/.test(engine), 'the engine must NEVER unregister a service worker or delete a cache itself -- deletion only ever happens inside the browser\'s own atomic SW install/activate lifecycle, never from this code');
assert(engine.includes("reason: 'offline'") && engine.includes("reason: 'error'"), 'the engine must resolve a typed failure reason on rollback, never throw past its own boundary');
assert(engine.includes('No pudimos actualizar ahora'), 'the rollback message must match the required copy exactly');

// ── Every user-facing update entry point must be a thin wrapper around
// the SAME engine -- never its own destroy-first copy. ──
// Note: read-only diagnostics (e.g. repair.html's own device-status panel,
// which calls getRegistrations()/caches.keys() purely to display counts) are
// legitimate and must NOT trip this check -- only the two calls that
// actually destroy state (any `.unregister()`, regardless of the variable
// it's called on, and `caches.delete(`) are banned outside the engine.
for (const [name, source] of [['repair.html', repair], ['index.html (boot-recovery)', index], ['firebase-service.js (access gate)', firebaseService]]) {
  assert(!/\.unregister\(\)|caches\.delete\(/.test(source),
    `${name} must never unregister a service worker or delete a cache directly -- that is exactly the destroy-before-confirming bug real customers hit. It must call window.click360SafeUpdate() instead.`);
}
assert(repair.includes('safe-update.js'), 'repair.html must load the shared safe-update.js engine');
assert(repair.includes('window.click360SafeUpdate('), 'repair.html\'s update button must call the shared engine, not a local reimplementation');
assert(repair.includes('sigue funcionando'), 'repair.html\'s rollback message must reassure the user their current version still works');
assert(index.includes('safe-update.js'), 'index.html must load the shared safe-update.js engine (inline, before app.js -- the boot-recovery screen must work even if app.js itself failed to load)');
assert(index.includes('window.click360SafeUpdate('), 'the boot-recovery "Actualizar aplicacion" button must call the shared engine, not a local reimplementation');
assert(firebaseService.includes('window.click360SafeUpdate('), 'the access gate\'s "Actualizar archivos de la app" button must call the shared engine, not a local reimplementation');
assert(firebaseService.includes('sigue funcionando'), 'the access gate\'s rollback message must reassure the user their current version still works');

// ── The manifest itself is a real, tracked, versioned file the build
// pipeline stamps on every release (not hand-maintained drift bait). ──
assert(fs.existsSync('release-manifest.json'), 'release-manifest.json must exist as a real tracked source file');
const manifest = JSON.parse(fs.readFileSync('release-manifest.json', 'utf8'));
assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'release-manifest.json must carry a non-empty version field');
assert(buildScript.includes("'release-manifest.json'"), 'the static release build must copy release-manifest.json into dist/');
assert(buildScript.includes("'safe-update.js'"), 'the static release build must copy the shared safe-update.js engine into dist/');
assert(buildScript.includes('manifest.buildSha = shortSha'), 'the build must stamp the real build SHA into the manifest on every release, not leave a stale placeholder');

// ── service-worker.js must exempt BOTH the rescue page and its
// reachability probe from its own fetch interception -- a stale/broken
// worker must never be able to intercept the one page designed to fix it,
// and must cache the shared engine as a normal core asset (so it keeps
// working offline like every other core script). ──
assert(/pathname\.endsWith\('\/repair\.html'\) \|\| url\.pathname\.endsWith\('\/release-manifest\.json'\)/.test(sw), 'service-worker.js must bypass BOTH /repair.html and /release-manifest.json requests entirely');
assert(sw.includes("'./safe-update.js'"), 'service-worker.js must cache safe-update.js as a normal core asset (offline boot must still be able to load it)');

console.log('PASS r37.1/r37.2.1 safe-update harness: ONE shared PREPARE->COMMIT->ROLLBACK engine (safe-update.js) -- offline check + no-store manifest reachability probe -> real registration.update()/register() through to a confirmed-active worker, bounded by a timeout -> any failure leaves the existing app fully intact with a clear "sigue funcionando" message -- and repair.html, the boot-recovery screen, AND the access gate\'s update button all call the SAME engine; none of them unregisters a service worker or deletes a cache directly anymore.');
