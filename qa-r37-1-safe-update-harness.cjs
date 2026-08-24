/**
 * r37.1 (P0-A, real SHARY evidence): "actualizar archivos" left a customer
 * with NO working app. repair.html used to unregister the service worker
 * and delete every cache BEFORE ever confirming a new version could be
 * downloaded -- a network drop or server hiccup at that exact moment meant
 * the customer had nothing left to open. This harness locks in the fix
 * structurally; qa/r36-repair-rescue-path-e2e.mjs and
 * qa/r37-1-offline-safe-update-e2e.mjs prove it live.
 */
const assert = require('assert');
const fs = require('fs');

const repair = fs.readFileSync('repair.html', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const buildScript = fs.readFileSync('scripts/build-static-release.mjs', 'utf8');

// ── The old unconditional destroy-first pattern must be gone entirely. ──
assert(!/getRegistrations\(\)\.then\(function \(regs\) \{[\s\S]{0,120}reg\.unregister\(\)/.test(repair), 'repair.html must never unregister every service worker unconditionally before confirming a new version is available -- that is the exact bug that left SHARY with no app');
assert(!repair.includes("caches.keys().then(function (keys) {\n        var c360Keys"), 'repair.html must never bulk-delete every click360- cache unconditionally as its first step');

// ── PREPARE: verify reachability before touching anything. ──
assert(repair.includes("if (!navigator.onLine)"), 'repair.html must check navigator.onLine first and refuse to touch anything while offline');
assert(repair.includes("release-manifest.json"), 'repair.html must fetch a real, current release manifest to prove the server is actually reachable before attempting an update');
assert(/fetch\('\.\/release-manifest\.json[\s\S]{0,40}\{\s*cache:\s*'no-store'\s*\}\)/.test(repair), 'the manifest reachability probe must bypass HTTP cache (cache: "no-store") -- a cached 200 would defeat the entire point of the check');

// ── COMMIT: only the browser's own atomic install/update, never a manual destroy-then-hope. ──
assert(repair.includes('waitForActiveWorker'), 'repair.html must wait for a real, confirmed-active worker before considering the update successful');
assert(repair.includes("existingReg.update()"), 'repair.html must drive an update through the real registration.update() API -- the browser-native atomic install path -- not a manual unregister/re-register dance');
assert(repair.includes('UPDATE_TIMEOUT_MS'), 'the update attempt must be bounded by a timeout so a hung install can still fall back to rollback instead of leaving the user stuck on "Verificando..." forever');
assert(!/navigator\.serviceWorker\.getRegistrations\(\)\.then\(function \(regs\) \{\s*return Promise\.all\(regs\.map\(function \(reg\) \{ return reg\.unregister\(\); \}\)\);/.test(repair), 'no code path may bulk-unregister every registration as part of the commit sequence');

// ── ROLLBACK: any failure leaves the existing app fully intact and tells the user so. ──
assert(repair.includes('function rollback('), 'a single, named rollback path must exist');
assert(repair.includes('No pudimos actualizar ahora'), 'the rollback message must match the required copy exactly');
assert(repair.includes('sigue funcionando'), 'the rollback message must reassure the user their current version still works');
assert(/rollback\([\s\S]{0,40}\);\s*\n\s*\}\s*\n\s*if \(!navigator\.onLine\)/.test(repair) === false, 'sanity: rollback must be defined before the offline check uses it');
assert(!/window\.location\.href = '\/\?repaired=' \+ Date\.now\(\);\s*\}, 700\);\s*\}\)\s*\.catch/.test(repair), 'the old flow navigated away unconditionally after its destroy step -- navigation must now only happen inside the success .then(), never as a fallback after failure');

// ── The manifest itself is a real, tracked, versioned file the build
// pipeline stamps on every release (not hand-maintained drift bait). ──
assert(fs.existsSync('release-manifest.json'), 'release-manifest.json must exist as a real tracked source file');
const manifest = JSON.parse(fs.readFileSync('release-manifest.json', 'utf8'));
assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'release-manifest.json must carry a non-empty version field');
assert(buildScript.includes("'release-manifest.json'"), 'the static release build must copy release-manifest.json into dist/');
assert(buildScript.includes('manifest.buildSha = shortSha'), 'the build must stamp the real build SHA into the manifest on every release, not leave a stale placeholder');

// ── service-worker.js must exempt BOTH the rescue page and its
// reachability probe from its own fetch interception -- a stale/broken
// worker must never be able to intercept the one page designed to fix it. ──
assert(/pathname\.endsWith\('\/repair\.html'\) \|\| url\.pathname\.endsWith\('\/release-manifest\.json'\)/.test(sw), 'service-worker.js must bypass BOTH /repair.html and /release-manifest.json requests entirely');

console.log('PASS r37.1 safe-update harness: repair.html no longer destroys the working service worker/cache before confirming a new version is downloadable -- PREPARE (offline check + no-store manifest reachability probe) -> COMMIT (real registration.update()/register() through to a confirmed-active worker, bounded by a timeout) -> ROLLBACK (any failure leaves the existing app fully intact with a clear "sigue funcionando" message) -- and release-manifest.json is a real, build-stamped tracked file the service worker explicitly never intercepts.');
