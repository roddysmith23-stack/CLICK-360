import { spawn } from 'node:child_process';
import { copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.1 (P0-A, explicit requirement): "Offline-first upgrade E2E
 * obligatorio: versión vieja funcional; red se cae durante update; sigue
 * abriendo versión vieja; red vuelve; update completa; nueva versión
 * READY."
 *
 * Unlike qa/r36-repair-rescue-path-e2e.mjs (which mocks
 * navigator.serviceWorker to verify repair.html's own PREPARE/COMMIT/
 * ROLLBACK call sequence), this test drives a REAL service worker install/
 * update lifecycle against a minimal, disposable fixture -- proving the
 * underlying browser-native guarantee the whole safe-update design leans
 * on: a service worker install that fails while offline never replaces
 * the currently active one, and a subsequent successful install (once
 * reconnected) does.
 */
const root = path.resolve(import.meta.dirname, '..');
const fixtureDir = path.join(root, 'qa/fixtures/r37-1-safe-update');
const port = Number(process.env.CLICK360_SAFE_UPDATE_E2E_PORT || 4737);
const url = `http://127.0.0.1:${port}/qa/fixtures/r37-1-safe-update/index.html`;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function resetFixture() {
  await copyFile(path.join(fixtureDir, 'service-worker.v1.js'), path.join(fixtureDir, 'service-worker.js'));
  await copyFile(path.join(fixtureDir, 'version.v1.txt'), path.join(fixtureDir, 'version.txt'));
  await rm(path.join(fixtureDir, 'service-worker.js.unavailable'), { force: true });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Fixture server did not start.');
}

async function run() {
  await resetFixture(); // start from a known v1 state regardless of a prior run's cleanup
  const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 1. "Versión vieja funcional" -- the v1 service worker installs and
    // activates normally, and serves v1 content.
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => window.__ready);
    const initialVersion = await page.evaluate(async () => (await (await fetch('./version.txt', { cache: 'no-store' })).text()).trim());
    assert(initialVersion === 'V1', `the old service worker must be functional and serving v1 content, got "${initialVersion}"`);

    // Simulate a new deploy landing on the server while this device is
    // still on v1 -- but the deploy is mid-flight: the new worker script is
    // momentarily unavailable (a 404), the exact real-world condition a
    // network drop or a CDN/deploy race produces. Playwright's
    // context.setOffline() reliably blocks page-level fetches (verified
    // separately) but NOT the browser process's own service-worker
    // update-check fetch (a known Chromium/CDP limitation), so this test
    // forces the failure deterministically at the source instead.
    await copyFile(path.join(fixtureDir, 'version.v2.txt'), path.join(fixtureDir, 'version.txt'));
    await rename(path.join(fixtureDir, 'service-worker.js'), path.join(fixtureDir, 'service-worker.js.unavailable'));

    // 2. "Red se cae durante update" -- attempt an update while the new
    // worker script can't be fetched. The browser's own atomic install
    // semantics mean this can never disturb the currently active worker.
    await context.setOffline(true); // also verifies page-level requests genuinely see "no network" throughout this window
    const offlineUpdateOutcome = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      try { await reg.update(); } catch (error) { return { updateThrew: true, message: error.message }; }
      return { updateThrew: false, hasInstalling: !!reg.installing, hasWaiting: !!reg.waiting };
    });
    // Whether update() itself rejects or silently finds nothing to install
    // varies by engine, but the guarantee that matters is the same either
    // way: no new worker ever takes over while the fetch couldn't succeed.
    if (!offlineUpdateOutcome.updateThrew) {
      assert(!offlineUpdateOutcome.hasInstalling && !offlineUpdateOutcome.hasWaiting, 'an update attempted while the new version cannot be fetched must never leave a new worker installing/waiting to take over');
    }

    // 3. "Sigue abriendo versión vieja" -- the app must still be fully
    // functional on the OLD version (served entirely from the v1 cache, no
    // network needed) while the page itself has no network at all.
    const stillOldVersion = await page.evaluate(async () => (await (await fetch('./version.txt')).text()).trim());
    assert(stillOldVersion === 'V1', `the device must keep serving the OLD version through a failed update attempt, got "${stillOldVersion}"`);
    const stillControllingV1 = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg.active && reg.active.scriptURL.includes('service-worker.js');
    });
    assert(stillControllingV1, 'the original service worker must still be the one active and in control after the failed update attempt');

    // 4. "Red vuelve; update completa" -- reconnect AND let the new worker
    // script become fetchable again (the deploy actually landing); retry
    // the update, which now genuinely installs the new version. The
    // renamed-aside file held the OLD (v1) content, so the real v2 script
    // is copied into place fresh here rather than restoring that one.
    await context.setOffline(false);
    await copyFile(path.join(fixtureDir, 'service-worker.v2.js'), path.join(fixtureDir, 'service-worker.js'));
    await rm(path.join(fixtureDir, 'service-worker.js.unavailable'));
    const onlineUpdateOutcome = await page.evaluate(() => new Promise(async (resolve, reject) => {
      const reg = await navigator.serviceWorker.getRegistration();
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the v2 worker to activate.')), 20000);
      function trackAndResolve(worker) {
        if (!worker) return;
        if (worker.state === 'activated') { clearTimeout(timeout); resolve('already-activated'); return; }
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') { clearTimeout(timeout); resolve('activated'); }
        });
      }
      reg.addEventListener('updatefound', () => trackAndResolve(reg.installing));
      await reg.update();
      if (reg.installing) trackAndResolve(reg.installing);
    }));
    assert(['activated', 'already-activated'].includes(onlineUpdateOutcome), `the new worker must reach the activated state once reconnected, got "${onlineUpdateOutcome}"`);

    // 5. "Nueva versión READY" -- the app now genuinely serves v2 content.
    const finalVersion = await page.evaluate(async () => (await (await fetch('./version.txt', { cache: 'no-store' })).text()).trim());
    assert(finalVersion === 'V2', `once reconnected and updated, the device must serve the NEW version, got "${finalVersion}"`);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37.1 offline-first safe-update E2E PASS: the old version stays fully functional through a network drop mid-update (no partial/broken install ever takes over), and once reconnected the new version installs and activates cleanly -- READY.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await resetFixture(); // leave the checked-in fixture in its default v1 state
  }
}

await run();
