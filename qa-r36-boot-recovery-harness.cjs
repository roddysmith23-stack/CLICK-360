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
assert(/SAFE_TERMINAL_GATE_STATES[\s\S]{0,300}'unauthenticated'/.test(html), "'unauthenticated' must stay a safe terminal state -- a healthy first-time visitor also has an empty #app the whole time they're on the login screen");
assert(!/SAFE_TERMINAL_GATE_STATES[\s\S]{0,400}'ready'/.test(html), "'ready' must NOT be a safe terminal state -- READY means the app should be visibly rendering into #app; if it still isn't, that's the exact SHARY-shaped stall this exists to catch");
assert(html.includes('const showBootRecovery = ()'), 'a dedicated boot-recovery renderer must exist');
assert(html.includes("if (appHasRendered()) finish(); else showBootRecovery();"), 'the hard-fallback timer must branch on appHasRendered(), not unconditionally hide the splash');
assert(html.includes('id="click360BootRetry"'), 'recovery screen must offer a Retry action');
assert(html.includes('id="click360BootUpdate"'), 'recovery screen must offer an Update-app action');
assert(html.includes('registration.unregister()'), 'the update action must unregister stale service worker registrations');
assert(html.includes("keys.filter((key) => key.startsWith('click360-'))"), 'the update action must clear CLICK 360 caches specifically (scoped to the click360- prefix), never an unscoped wipe of every cache in the browser');
assert(html.includes('wa.me/593969399562'), 'recovery screen must offer a real support contact path (Reportar problema), consistent with the rest of the app');
assert(html.includes("window.CLICK360_LAST_RUNTIME_ERROR?.reportId"), 'recovery screen must surface the runtime-guard error code when one was captured, for support diagnosis');

assert(styles.includes('.click360BootRecovery{pointer-events:auto'), 'the recovery screen must explicitly re-enable pointer-events (the base .click360Splash sets pointer-events:none)');
assert(styles.includes('.click360BootRecoveryBtn{pointer-events:auto'), 'recovery buttons must be individually clickable');

console.log('PASS r36 boot-recovery harness: stalled-boot recovery screen exists, correctly distinguishes a genuine stall from a healthy login-gate visitor, and its actions (retry/update/report) are wired');
