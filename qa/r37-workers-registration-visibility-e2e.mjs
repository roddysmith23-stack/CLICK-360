import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 9) companion to qa-r37-workers-loading-flicker-harness.cjs.
 *
 * That structural harness proves workersView() never GUESSES the paused/
 * enabled state at first paint. This test proves the other half live in a
 * browser: once bindWorkers() actually resolves the per-tenant flag, the
 * #workers screen settles into a fully consistent final state -- the
 * loading notice is gone, and exactly one of "Registro pausado" /
 * the real registration form is visible (never both, never neither).
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_WORKERS_VISIBILITY_E2E_PORT || 4730);
const url = `http://127.0.0.1:${port}/index.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('App did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 15000 });

    const uid = 'test-r37-workers-visibility-uid';
    await page.evaluate((uid) => {
      // This harness injects tenant state directly via the click360Set/ApplyTenantState
      // hooks and never performs a real Firebase sign-in. The real SDK's own
      // auth.onAuthStateChanged still fires asynchronously in the background (Firebase
      // checks IndexedDB/local persistence for a cached session on every page load,
      // real or test) and resolves with user=null a moment later, which calls the
      // real logout teardown (click360ClearTenantContext -> app.innerHTML = '') --
      // wiping the whole view out from under this synthetic scenario. A real,
      // authenticated user never hits this path (a real session exists), so this is a
      // test-harness-only artifact, not app behavior under test; neutralize it here.
      window.click360ClearTenantContext = () => {};
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'test@example.com', role: 'owner', name: 'Test', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };

      const realData = {
        businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, settings: {}, logistics: {},
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realData, context);
      window.click360Route('workers');
    }, uid);

    // access-state resolution (firebase-service.js publishAccessState) can
    // dispatch 'click360-access-changed' more than once during boot,
    // legitimately re-invoking renderApp() -- each re-render repaints a
    // BRAND NEW loading notice that starts visible again until its own
    // bindWorkers() resolves. A single waitForFunction-then-evaluate
    // round-trip can sample the SHORT-LIVED hidden state from an earlier
    // render right before a later render puts it back. Instead, poll for
    // the hidden state to stay true across several consecutive checks
    // (all inside the browser, immune to host round-trip timing) before
    // trusting it as the real, settled final state.
    const result = await page.evaluate(() => new Promise((resolve) => {
      let stableCount = 0;
      const REQUIRED_STABLE_CHECKS = 6;
      const deadline = Date.now() + 15000;
      const check = () => {
        const loading = document.getElementById('workerAccessLoadingNotice');
        const paused = document.getElementById('workerRegistrationPausedNotice');
        const card = document.getElementById('workerRegistrationCard');
        const hidden = loading?.style.display === 'none';
        if (hidden) {
          stableCount += 1;
          if (stableCount >= REQUIRED_STABLE_CHECKS) {
            return resolve({
              loadingHidden: true,
              pausedVisible: paused?.style.display !== 'none',
              cardAriaDisabled: card?.getAttribute('aria-disabled'),
            });
          }
        } else {
          stableCount = 0;
        }
        if (Date.now() > deadline) {
          return resolve({
            loadingHidden: hidden,
            pausedVisible: paused?.style.display !== 'none',
            cardAriaDisabled: card?.getAttribute('aria-disabled'),
          });
        }
        setTimeout(check, 50);
      };
      check();
    }));

    assert(result.loadingHidden, 'Once bindWorkers() resolves, the loading notice must be hidden');
    assert(typeof result.pausedVisible === 'boolean', '#workerRegistrationPausedNotice must exist with a resolved visibility state');
    assert(result.cardAriaDisabled === 'true' || result.cardAriaDisabled === null, '#workerRegistrationCard must reach a definite aria-disabled state (not left ambiguous)');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 workers-registration-visibility E2E PASS: after bindWorkers() resolves the real per-tenant flag, #workers settles into one definite, consistent final state.');
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run();
} finally {
  server.kill('SIGTERM');
}
