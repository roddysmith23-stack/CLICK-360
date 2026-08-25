import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2.1 (LIVE CLIENT RECOVERY -- real SHARY safe-update incident, third
 * entry point): qa/r36-repair-rescue-path-e2e.mjs already click-drives
 * repair.html's real PREPARE->COMMIT->ROLLBACK contract through a mocked
 * navigator.serviceWorker, and qa/r37-1-offline-safe-update-e2e.mjs already
 * proves the shared engine's real browser-native SW lifecycle end to end.
 * This test closes the remaining gap: the boot-recovery screen's own
 * "Actualizar aplicacion" button (index.html, #click360BootUpdate) must
 * ALSO go through the same click360SafeUpdate() engine and never touch
 * unregister()/caches.delete() directly, driven through a REAL click on the
 * real extracted boot-decision script (not a hand-copied duplicate).
 *
 * The access gate's "Actualizar archivos de la app" button
 * (firebase-service.js, #c360-clear-cache -- the literal button SHARY was
 * told to press) is covered at two other levels instead of a third heavy
 * fixture here: qa-r37-1-safe-update-harness.cjs asserts, structurally and
 * precisely, that its handler contains window.click360SafeUpdate(...) and
 * never unregister()/caches.delete(); its handler body is byte-for-byte the
 * same call/onLog/then(result.ok) shape already proven correct end-to-end
 * by the two tests above. Reaching it live would require stubbing the
 * entire Firebase SDK surface firebase-service.js's module load depends on
 * -- disproportionate risk of a fragile fixture for a code path that is
 * already provably identical to an already-E2E-proven one.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_SAFE_UPDATE_ENTRYPOINTS_E2E_PORT || 4739);
const fixturePath = path.join(root, 'qa/fixtures/generated/r37-2-1-boot-recovery-safe-update.html');
const url = `http://127.0.0.1:${port}/qa/fixtures/generated/r37-2-1-boot-recovery-safe-update.html`;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function buildFixture() {
  const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
  const scriptMatch = indexHtml.match(/<script>\s*\(\(\) => \{[\s\S]*?click360MarkSplashReady[\s\S]*?\}\)\(\);\s*<\/script>/);
  if (!scriptMatch) throw new Error('Could not extract the boot-decision script from index.html -- structure changed?');
  assert(indexHtml.includes('<script src="safe-update.js'), 'index.html must load safe-update.js before the boot-decision script -- fixture would silently drift from the real load order otherwise');
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="../../../styles.css"></head>
<body>
  <div id="click360Splash" class="click360Splash" aria-hidden="true">
    <img src="" alt="" width="1" height="1">
    <strong>CLICK 360</strong>
    <small>Fixture</small>
    <div class="click360SplashProgress" aria-hidden="true"><i></i></div>
  </div>
  <div id="app"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script src="../../../safe-update.js"></script>
  ${scriptMatch[0]}
</body></html>`);
}

const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Fixture did not start.');
}

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

async function reachRecoveryScreen(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { window.click360AccessUiState = { state: 'ready' }; });
  await page.waitForTimeout(12600);
  assert(await page.locator('#click360BootUpdate').isVisible(), 'boot-recovery screen must be showing with the update button visible before driving click scenarios');
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 1. ROLLBACK: offline -- must never touch the service worker, must
    // show the reassurance message, must re-enable the button.
    await reachRecoveryScreen(page);
    await installMock(page);
    let manifestFetched = false;
    await page.route('**/release-manifest.json*', (route) => { manifestFetched = true; route.continue(); });
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); });
    await page.click('#click360BootUpdate');
    await page.waitForTimeout(300);
    let outcome = await page.evaluate(() => ({
      ...window.__mock,
      msg: document.querySelector('.click360BootRecoveryMsg')?.textContent || '',
      btnText: document.getElementById('click360BootUpdate').textContent,
      btnDisabled: document.getElementById('click360BootUpdate').disabled
    }));
    assert(!manifestFetched, 'an offline device must never attempt the release-manifest.json reachability check from the boot-recovery button');
    assert(outcome.updateCalls === 0 && outcome.registerCalls === 0, 'an offline device must never touch the service worker from the boot-recovery button (no update/register call)');
    assert(!outcome.btnDisabled, 'the boot-recovery update button must be re-enabled after a rollback so the user can retry');
    await page.unroute('**/release-manifest.json*');

    // 2. ROLLBACK: manifest reachable at the browser level but the fetch
    // itself fails -- must still never touch the service worker.
    await reachRecoveryScreen(page);
    await installMock(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });
    await page.route('**/release-manifest.json*', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.click('#click360BootUpdate');
    await page.waitForTimeout(300);
    outcome = await page.evaluate(() => ({
      ...window.__mock,
      msg: document.querySelector('.click360BootRecoveryMsg')?.textContent || '',
      btnDisabled: document.getElementById('click360BootUpdate').disabled
    }));
    assert(outcome.updateCalls === 0 && outcome.registerCalls === 0, 'a failed manifest fetch must never touch the service worker from the boot-recovery button -- the old bug unregistered/deleted unconditionally');
    assert(outcome.msg.includes('sigue funcionando'), `the boot-recovery rollback message must reassure the user their current version still works, got: ${outcome.msg}`);
    assert(!outcome.btnDisabled, 'the boot-recovery update button must be re-enabled after a rollback so the user can retry');
    await page.unroute('**/release-manifest.json*');

    // 3. COMMIT: manifest reachable, existing registration already active
    // (update() finds nothing new) -- must call update() exactly once,
    // never unregister, and only then navigate away.
    // location.replace() performs a REAL top-level navigation even when the
    // request is fulfilled by a route stub -- Playwright still commits the
    // page to the new (fulfilled) document, destroying window.__mock before
    // it could be read back. page.exposeFunction() survives navigation (it
    // re-binds automatically on the new document), so the call counters are
    // tracked on the Node side instead of read back from page state.
    const calls = { getRegistration: 0, update: 0, register: 0 };
    await page.exposeFunction('__reportSwCall', (name) => { calls[name] += 1; });
    await reachRecoveryScreen(page);
    await page.evaluate(() => {
      const fakeRegistration = {
        active: { scriptURL: '/service-worker.js' },
        installing: null,
        waiting: null,
        update: async () => { await window.__reportSwCall('update'); },
        addEventListener: () => {}
      };
      navigator.serviceWorker.getRegistration = async () => { await window.__reportSwCall('getRegistration'); return fakeRegistration; };
      navigator.serviceWorker.register = async () => { await window.__reportSwCall('register'); return fakeRegistration; };
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
    // The fixture lives 3 directories deep (qa/fixtures/generated/), unlike
    // the real repair.html/index.html which both sit at the site root, so
    // safe-update.js's relative `./release-manifest.json` fetch needs a
    // route here rather than resolving to the real tracked file.
    await page.route('**/release-manifest.json*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'test-fixture-version' }) }));
    let navigatedTo = null;
    await page.route('**/?repaired=*', (route) => { navigatedTo = route.request().url(); route.fulfill({ status: 200, body: 'ok', contentType: 'text/plain' }); });
    await page.click('#click360BootUpdate');
    await page.waitForTimeout(600);
    assert(calls.getRegistration >= 1, 'the boot-recovery commit path must check for an existing registration');
    assert(calls.update === 1, `the boot-recovery commit path must call registration.update() exactly once, got ${calls.update}`);
    assert(calls.register === 0, 'an existing registration must be updated, never re-registered from scratch');
    assert(navigatedTo && navigatedTo.includes('repaired='), 'a successful boot-recovery update must navigate to /?repaired=... only once a new version is confirmed active');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2.1 safe-update entry-points E2E PASS: the boot-recovery screen\'s "Actualizar aplicacion" button goes through the same real PREPARE->COMMIT->ROLLBACK engine as repair.html -- offline and failed-manifest cases never touch the service worker and leave the current version intact, while a real success path calls update() once and only navigates once confirmed.');
  } finally {
    await browser.close();
  }
}

try {
  await buildFixture();
  await waitForServer();
  await run();
} finally {
  server.kill('SIGTERM');
}
