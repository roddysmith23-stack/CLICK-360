import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2.2 (P0, LIVE CLIENT -- the real SHARY incident, second failure mode):
 * index.html's service-worker "self-heal" reloads the page once per session
 * when it looks safe to do so (no modal open, sitting on the neutral #home
 * route). The cloud-recovery flow closes any open modal and lands on #home
 * exactly while a hydration is in flight -- so right after a deploy, that
 * auto-heal reload could fire in that precise window, restart the whole boot
 * sequence mid-sync, and throw the customer back to the public access gate
 * ("Verificando acceso...") with her data still not recovered.
 *
 * The fix gates the reload on window.click360SyncStatus?.status !== 'syncing'
 * (a global already published live by firebase-service.js setSyncStatus()),
 * retrying once a second for up to ~10s before giving up quietly.
 *
 * This drives the REAL index.html in a REAL Chromium with a REAL registered
 * service worker (no product file is modified): the controllerchange event
 * is dispatched for real on navigator.serviceWorker, and the assertions are
 * on whether the page actually navigated.
 *
 * Phases:
 *  1. Sync busy -> the auto-heal must NOT reload (the exact regression).
 *  2. Sync goes idle -> the deferred auto-heal must still happen (the
 *     self-heal feature is delayed, never disabled).
 *  3. Sync stays busy past the whole retry budget -> it must give up
 *     quietly and never reload.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_SW_SYNC_GUARD_PORT || 4763);
const url = `http://127.0.0.1:${port}/index.html`;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('App did not start.');
}

/**
 * Boots index.html twice so the page ends up genuinely CONTROLLED by its own
 * real service worker -- the handler under test returns immediately unless a
 * controller already existed at load time (hadServiceWorkerController).
 */
async function bootControlledPage(browser, syncStatus) {
  const context = await browser.newContext();
  await context.addInitScript((initialStatus) => {
    try {
      const previous = Number(sessionStorage.getItem('__click360TestNavCount') || '0');
      sessionStorage.setItem('__click360TestNavCount', String(previous + 1));
    } catch {}
    // Captured at the same moment index.html's inline script captures
    // hadServiceWorkerController -- the handler under test bails out
    // immediately unless a controller was already in place at page load.
    window.__controllerAtLoad = !!navigator.serviceWorker.controller;
    // Own the sync-status global so this test controls "is a hydration in
    // flight?" deterministically -- and so the app's own setSyncStatus()
    // cannot overwrite it mid-assertion. Reads see exactly the same shape
    // firebase-service.js publishes.
    window.__qaSyncStatus = { status: initialStatus, message: 'qa-controlled' };
    Object.defineProperty(window, 'click360SyncStatus', {
      configurable: true,
      get() { return window.__qaSyncStatus; },
      set() { /* the app's own publishes are ignored in this harness */ }
    });
  }, syncStatus);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', (route) => (route.request().url().startsWith(`http://127.0.0.1:${port}/`) ? route.continue() : route.abort()));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((registration) => !!registration?.active), { timeout: 30000 });
  let controlledAtLoad = false;
  for (let attempt = 0; attempt < 5 && !controlledAtLoad; attempt += 1) {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 }).catch(() => {});
    await page.reload({ waitUntil: 'load' });
    controlledAtLoad = await page.evaluate(() => window.__controllerAtLoad === true);
  }
  assert(controlledAtLoad, 'sanity: the page must already be controlled by its own real service worker AT LOAD TIME, or index.html\'s auto-heal handler exits before any of this matters');
  return { context, page, pageErrors };
}

const navCount = (page) => page.evaluate(() => Number(sessionStorage.getItem('__click360TestNavCount') || '0'));

async function assertSafePreconditions(page) {
  const state = await page.evaluate(() => ({
    hash: location.hash,
    hasModal: document.body.classList.contains('has-modal'),
    healed: sessionStorage.getItem('CLICK360_SW_AUTO_HEAL_DONE') === '1'
  }));
  assert(state.hash === '' || state.hash === '#home', `sanity: the auto-heal only ever runs on the neutral route, got "${state.hash}"`);
  assert(state.hasModal === false, 'sanity: the auto-heal only ever runs with no modal open');
  assert(state.healed === false, 'sanity: the auto-heal must not already have been consumed this session');
}

const fireControllerChange = (page) => page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));

async function run() {
  const browser = await chromium.launch();
  const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });
  try {
    await waitForServer();

    // ── Phases 1 + 2: busy during the event, idle shortly after ──
    const busySession = await bootControlledPage(browser, 'syncing');
    try {
      const { page, pageErrors } = busySession;
      await assertSafePreconditions(page);
      const before = await navCount(page);

      await fireControllerChange(page);
      await page.waitForTimeout(3500); // well past the un-gated 900ms reload
      const duringSync = await navCount(page);
      assert(duringSync === before, `[1] a new service worker taking over MUST NOT reload the page while a cloud hydration is in flight -- boot count went ${before} -> ${duringSync} (this is the exact race that dropped the customer back on "Verificando acceso...")`);
      const stillOnPage = await page.evaluate(() => sessionStorage.getItem('CLICK360_SW_AUTO_HEAL_DONE') === '1');
      assert(stillOnPage === false, '[1] the once-per-session auto-heal must not be consumed by an attempt that was deferred for being mid-sync');

      // ── Phase 2: the hydration finishes; the deferred heal must still run ──
      await page.evaluate(() => { window.__qaSyncStatus = { status: 'synced', message: 'qa-controlled' }; });
      await page.waitForFunction(
        (baseline) => Number(sessionStorage.getItem('__click360TestNavCount') || '0') > baseline,
        before,
        { timeout: 15000 }
      ).catch(() => {});
      const afterSync = await navCount(page);
      assert(afterSync > duringSync, `[2] once the sync finishes, the deferred self-heal must still apply the new version (the fix delays the reload, it must never disable it) -- boot count stayed at ${afterSync}`);

      if (pageErrors.length) throw new Error(`[1/2] unexpected page errors: ${JSON.stringify(pageErrors)}`);
      console.log('CLICK 360 r37.2.2 SW auto-heal sync guard PASS (phases 1-2): a service-worker takeover during an in-flight cloud hydration never reloads mid-sync, and the deferred self-heal still applies as soon as the sync settles.');
    } finally {
      await busySession.context.close();
    }

    // ── Phase 3: sync never settles within the retry budget ──
    const stuckSession = await bootControlledPage(browser, 'syncing');
    try {
      const { page, pageErrors } = stuckSession;
      await assertSafePreconditions(page);
      const before = await navCount(page);
      await fireControllerChange(page);
      // ~10 one-second retries + the 900ms reload delay, plus margin.
      await page.waitForTimeout(14000);
      const after = await navCount(page);
      assert(after === before, `[3] if the sync never settles, the auto-heal must give up quietly and never reload -- boot count went ${before} -> ${after}`);
      const stateAfter = await page.evaluate(() => ({
        healed: sessionStorage.getItem('CLICK360_SW_AUTO_HEAL_DONE') === '1',
        gateText: document.getElementById('click360-auth-gate')?.textContent?.trim().slice(0, 80) || ''
      }));
      assert(stateAfter.healed === false, '[3] giving up must not consume the once-per-session auto-heal either');

      if (pageErrors.length) throw new Error(`[3] unexpected page errors: ${JSON.stringify(pageErrors)}`);
      console.log('CLICK 360 r37.2.2 SW auto-heal sync guard PASS (phase 3): a sync that never settles makes the auto-heal give up quietly instead of ever reloading over an in-flight hydration.');
    } finally {
      await stuckSession.context.close();
    }

    console.log('CLICK 360 r37.2.2 SW auto-heal sync guard E2E PASS.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
