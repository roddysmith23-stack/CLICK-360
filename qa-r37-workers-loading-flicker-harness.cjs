/**
 * r37 (Section 9): the Equipo (Workers) screen on mobile showed
 * "Registro pausado" for ~1 second on every load, then sometimes flipped
 * to the real registration form -- a visible flicker/flash of wrong
 * information.
 *
 * Root cause: workersView() used to render #workerRegistrationPausedNotice
 * (and #workerRegistrationCard) as an initial-paint GUESS based on the
 * static, project-only WORKER_TENANT_ACCESS_ENABLED flag, then
 * bindWorkers() corrected it asynchronously once the real per-tenant flag
 * arrived from Firestore -- guessing wrong and visibly correcting IS the
 * flicker. A live-browser E2E cannot exercise the async gap reliably (the
 * local test harness always resolves to the staging Firebase project on
 * 127.0.0.1, where WORKER_TENANT_ACCESS_ENABLED short-circuits true and
 * the await is never reached), so this is a structural regression gate:
 * it proves workersView() renders a genuine, neutral loading state by
 * default (never guessing paused/enabled), and that bindWorkers() is the
 * only place that reveals the real state -- once, when it's actually known.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

const workersViewBody = app.slice(app.indexOf('function workersView('), app.indexOf('function bindWorkers('));
assert(workersViewBody.length > 100, 'workersView() function body not found in app.js');

assert(
  /<section class="card sectionCard" id="workerAccessLoadingNotice">/.test(workersViewBody),
  'workersView() must render #workerAccessLoadingNotice, visible by default (no guess yet)'
);
assert(
  /id="workerRegistrationPausedNotice" style="display:none"/.test(workersViewBody),
  'workersView() must render #workerRegistrationPausedNotice hidden by default -- it must never guess "paused" before the real per-tenant flag is known'
);
assert(
  /id="workerRegistrationCard" style="display:none"/.test(workersViewBody),
  'workersView() must render #workerRegistrationCard hidden by default -- it must never guess "enabled" before the real per-tenant flag is known'
);
assert(
  !/id="workerAccessLoadingNotice"[^>]*style="display:none"/.test(workersViewBody),
  'the loading notice itself must be VISIBLE at first paint (no display:none on it) -- it is the neutral state, not something to hide'
);

const bindWorkersBody = app.slice(app.indexOf('function bindWorkers('), app.indexOf('function bindWorkers(') + 4000);
assert(
  /const tenantAccessEnabled = WORKER_TENANT_ACCESS_ENABLED\s*\n?\s*\|\|\s*\(await window\.click360CurrentOwnerWorkersEnabled/.test(bindWorkersBody),
  'bindWorkers() must resolve the real per-tenant flag (static WORKER_TENANT_ACCESS_ENABLED OR the awaited per-tenant Firestore check) before touching visibility'
);
assert(
  /if \(loadingNotice\) loadingNotice\.style\.display = 'none';/.test(bindWorkersBody),
  'bindWorkers() must hide the loading notice only AFTER the real flag is resolved, not before'
);
assert(
  bindWorkersBody.indexOf('const tenantAccessEnabled') < bindWorkersBody.indexOf("loadingNotice.style.display = 'none'"),
  'the real flag must be resolved BEFORE any visibility is changed -- reordering this would reintroduce a guess-then-correct flicker'
);

console.log('PASS r37 workers loading-flicker harness: #workers shows a genuine neutral loading state by default; bindWorkers() reveals the real paused/enabled state exactly once, after the per-tenant flag is actually known, never guessing first');
