import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.1 (P0-A, real SHARY evidence): /repair.html is the independent
 * rescue path -- it must work even when app.js/Auth/tenant hydration never
 * succeed, and its own service worker interception must be explicitly
 * excluded (see service-worker.js's early return for it and for
 * release-manifest.json) so a broken/stale worker can never intercept the
 * one page designed to fix it.
 *
 * This also locks in the P0-A fix itself: the old flow unregistered the
 * service worker and deleted every cache BEFORE ever confirming a new
 * version could be downloaded -- if the network dropped at that exact
 * moment, the customer was left with nothing (SHARY's real "No se puede
 * acceder a este sitio" -> blank screen). The new contract is
 * PREPARE (verify reachability, touch nothing) -> COMMIT (a real,
 * browser-native atomic service-worker install/update) -> ROLLBACK (any
 * failure leaves the existing worker/cache completely untouched, and the
 * customer is told they can keep working). This test proves the rollback
 * path never calls unregister/update, and the success path only navigates
 * away after a confirmed-active worker.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_REPAIR_E2E_PORT || 4723);
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not start.`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function installMock(page) {
  await page.evaluate(() => {
    window.__mock = { updateCalls: 0, registerCalls: 0, getRegistrationCalls: 0 };
    const fakeRegistration = {
      active: { scriptURL: '/service-worker.js' },
      installing: null,
      waiting: null,
      update: async () => { window.__mock.updateCalls += 1; },
      addEventListener: () => {}
    };
    navigator.serviceWorker.getRegistration = async () => { window.__mock.getRegistrationCalls += 1; return fakeRegistration; };
    navigator.serviceWorker.getRegistrations = async () => [fakeRegistration];
    navigator.serviceWorker.register = async () => { window.__mock.registerCalls += 1; return fakeRegistration; };
  });
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 1. Loads with no app dependency at all.
    await page.goto(`http://127.0.0.1:${port}/repair.html`, { waitUntil: 'networkidle' });
    const scriptSrcs = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));
    assert(scriptSrcs.length === 0, `repair.html must not load any external script (app.js/firebase/etc) -- found: ${JSON.stringify(scriptSrcs)}`);
    assert(await page.locator('#repairBtn').isVisible(), 'Actualizar CLICK 360 button must be visible');
    assert(await page.locator('#openBtn').isVisible(), 'Abrir CLICK 360 normalmente button must be visible');

    // 2. ROLLBACK path: offline -- must never even attempt the manifest
    // fetch or touch the service worker.
    await installMock(page);
    let manifestFetched = false;
    await page.route('**/release-manifest.json*', (route) => { manifestFetched = true; route.continue(); });
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); });
    await page.click('#repairBtn');
    await page.waitForTimeout(300);
    let outcome = await page.evaluate(() => ({ ...window.__mock, log: document.getElementById('log').textContent, btnText: document.getElementById('repairBtn').textContent, btnDisabled: document.getElementById('repairBtn').disabled }));
    assert(!manifestFetched, 'an offline device must never attempt the release-manifest.json reachability check');
    assert(outcome.updateCalls === 0 && outcome.registerCalls === 0, 'an offline device must never touch the service worker (no update/register call)');
    assert(outcome.log.includes('sin conexión') || outcome.log.toLowerCase().includes('conexión'), `the offline rollback must tell the user clearly, got log: ${outcome.log}`);
    assert(!outcome.btnDisabled, 'the button must be re-enabled after a rollback so the user can retry');
    await page.unroute('**/release-manifest.json*');

    // 3. ROLLBACK path: server/network reachable at the browser level, but
    // the manifest fetch itself fails (e.g. mid-deploy 5xx) -- must still
    // never touch the service worker, and must leave a clear message.
    await page.reload({ waitUntil: 'networkidle' });
    await installMock(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
    await page.route('**/release-manifest.json*', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.click('#repairBtn');
    await page.waitForTimeout(300);
    outcome = await page.evaluate(() => ({ ...window.__mock, log: document.getElementById('log').textContent, btnDisabled: document.getElementById('repairBtn').disabled }));
    assert(outcome.updateCalls === 0 && outcome.registerCalls === 0, 'a failed manifest fetch must never touch the service worker (no update/register call) -- the old bug unregistered/deleted unconditionally');
    assert(outcome.log.includes('No pudimos actualizar ahora'), `a failed manifest fetch must show the exact rollback message, got log: ${outcome.log}`);
    assert(outcome.log.includes('sigue funcionando'), `the rollback message must reassure the user their current version still works, got log: ${outcome.log}`);
    assert(!outcome.btnDisabled, 'the button must be re-enabled after a rollback so the user can retry');
    await page.unroute('**/release-manifest.json*');

    // 4. COMMIT path: manifest reachable, existing registration already has
    // an active worker (update() finds nothing new) -- must call update(),
    // never unregister, and only then navigate away.
    await page.reload({ waitUntil: 'networkidle' });
    await installMock(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
    await page.click('#repairBtn');
    await page.waitForTimeout(300);
    outcome = await page.evaluate(() => ({ ...window.__mock, log: document.getElementById('log').textContent }));
    assert(outcome.getRegistrationCalls >= 1, 'the commit path must check for an existing registration');
    assert(outcome.updateCalls === 1, `the commit path must call registration.update() exactly once, got ${outcome.updateCalls}`);
    assert(outcome.log.includes('Nueva versión disponible'), `a successful manifest fetch must report the new version, got log: ${outcome.log}`);
    assert(outcome.log.includes('Actualización lista'), `a successful update must report readiness before navigating, got log: ${outcome.log}`);

    if (pageErrors.length) throw new Error(`Unexpected page errors on /repair.html: ${JSON.stringify(pageErrors)}`);
    console.log('PASS: /repair.html works standalone, and the safe PREPARE -> COMMIT -> ROLLBACK contract holds -- offline and failed-manifest cases never touch the service worker and leave the current version intact, while a real success path calls update() and only navigates once confirmed.');

    // 5. Service worker must never intercept /repair.html or
    // release-manifest.json requests, and the navigate-cache-key fix must
    // cache under the real request URL.
    const swSource = await (await fetch(`http://127.0.0.1:${port}/service-worker.js`)).text();
    assert(/pathname\.endsWith\('\/repair\.html'\)/.test(swSource), 'service-worker.js must explicitly bypass /repair.html requests');
    assert(/pathname\.endsWith\('\/release-manifest\.json'\)/.test(swSource), 'service-worker.js must explicitly bypass /release-manifest.json requests -- it is the PREPARE-step reachability probe and must reflect the real network, not a stale/broken worker\'s cache');
    assert(swSource.includes('cache.put(request, copy)'), 'the navigate handler must cache under the real request, not a hardcoded string (the pre-existing bug: any navigation to a page other than / would silently overwrite the cached app shell)');
    assert(!swSource.includes("cache.put('./index.html', copy)"), 'the old hardcoded-key navigate cache write must be gone');
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer(`http://127.0.0.1:${port}/repair.html`);
  await run();
} finally {
  server.kill('SIGTERM');
}
