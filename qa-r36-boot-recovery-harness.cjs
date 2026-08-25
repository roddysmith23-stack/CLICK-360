/**
 * P0 (SHARY black-screen incident, r36): structural regression complementing
 * qa/r36-boot-recovery-e2e.mjs (the real-browser behavioral test). This is
 * the fast, no-Playwright gate that runs on every `npm run qa`, so a future
 * edit can't silently remove the recovery mechanism without the Playwright
 * suite also happening to be run.
 */
const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');

assert(html.includes('const appHasRendered = ()'), 'the boot script must expose a single appHasRendered() decision function');
assert(html.includes("SAFE_TERMINAL_GATE_STATES = new Set(["), 'the boot script must distinguish "gate legitimately showing something" states from a genuine stall');
// Precisely bounded to the Set([...]) literal itself, not a loose
// character window -- a loose window previously produced a false failure
// when unrelated code (fadeOutSplash's splash.classList.add('ready')) later
// happened to land within an arbitrary distance of the declaration.
const safeStatesStart = html.indexOf('SAFE_TERMINAL_GATE_STATES = new Set([');
const safeStatesEnd = html.indexOf(']);', safeStatesStart);
assert(safeStatesStart !== -1 && safeStatesEnd !== -1, 'could not locate the SAFE_TERMINAL_GATE_STATES literal to check its contents');
const safeStatesLiteral = html.slice(safeStatesStart, safeStatesEnd);
assert(safeStatesLiteral.includes("'unauthenticated'"), "'unauthenticated' must stay a safe terminal state -- a healthy first-time visitor also has an empty #app the whole time they're on the login screen");
assert(!safeStatesLiteral.includes("'ready'"), "'ready' must NOT be a safe terminal state -- READY means the app should be visibly rendering into #app; if it still isn't, that's the exact SHARY-shaped stall this exists to catch");
assert(html.includes('const showBootRecovery = ()'), 'a dedicated boot-recovery renderer must exist');
assert(html.includes("if (appHasRendered()) finish(); else showBootRecovery();"), 'the hard-fallback timer must branch on appHasRendered(), not unconditionally hide the splash');
// P0-2: a real staging observation (Auth/Firestore taking longer than the
// 12s hard-fallback on a genuinely slow-but-working connection) showed the
// recovery screen could latch permanently even after the app went on to
// boot successfully seconds later. The recovery screen must keep watching
// and quietly step aside if that happens -- never a second dead end.
assert(html.includes('const graceTimer = setInterval'), 'showBootRecovery() must keep watching for a real render after showing the recovery screen -- a slow-but-working boot must not be stranded on a permanent "no pudo iniciar"');
assert(/graceTimer[\s\S]{0,300}appHasRendered\(\)/.test(html), 'the post-recovery grace watcher must reuse the same appHasRendered() decision, not a narrower check');
assert(html.includes('id="click360BootRetry"'), 'recovery screen must offer a Retry action');
assert(html.includes('id="click360BootUpdate"'), 'recovery screen must offer an Update-app action');
// r37.2.1 (LIVE CLIENT RECOVERY -- real SHARY incident): this used to
// REQUIRE the update action to unregister()/caches.delete() BEFORE ever
// confirming a new version was downloadable -- destroy-first, exactly the
// bug that left a real customer with "No se puede acceder a este sitio"
// then a blank screen. The update action must now go through the shared,
// safe PREPARE->COMMIT->ROLLBACK engine (safe-update.js) instead, and must
// NEVER call unregister()/caches.delete() directly from a click handler.
assert(html.includes('window.click360SafeUpdate'), 'the update action must go through the shared click360SafeUpdate() engine (safe-update.js), not a hand-rolled destroy-first flow');
assert(!/click360BootUpdate[\s\S]{0,600}(registration\.unregister\(\)|getRegistrations\(\)|caches\.delete\()/.test(html), 'the boot-recovery update handler must NEVER unregister the service worker or delete caches directly -- that is exactly the destroy-before-confirming bug a real customer hit; deletion only ever happens inside the browser\'s own atomic SW install, never from this click handler');
assert(html.includes('safe-update.js'), 'index.html must load the shared safe-update.js engine');
assert(html.includes('wa.me/593969399562'), 'recovery screen must offer a real support contact path (Reportar problema), consistent with the rest of the app');
assert(html.includes("window.CLICK360_LAST_RUNTIME_ERROR?.reportId"), 'recovery screen must surface the runtime-guard error code when one was captured, for support diagnosis');

assert(styles.includes('.click360BootRecovery{pointer-events:auto'), 'the recovery screen must explicitly re-enable pointer-events (the base .click360Splash sets pointer-events:none)');
assert(styles.includes('.click360BootRecoveryBtn{pointer-events:auto'), 'recovery buttons must be individually clickable');

console.log('PASS r36 boot-recovery harness: stalled-boot recovery screen exists, correctly distinguishes a genuine stall from a healthy login-gate visitor, and its actions (retry/update/report) are wired');
