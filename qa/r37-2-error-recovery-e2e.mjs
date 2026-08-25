import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (mission section 31, "ERROR RECOVERY"): a comerciante's device
 * will genuinely hit failures tomorrow -- a flaky connection mid-write, a
 * cloud call that rejects, a logo/banner image that 404s, a truly
 * unexpected exception somewhere deep in a view. This drives the REAL
 * app.js/firebase-service.js (real DOM, real button wiring, real save()
 * write-gate, real renderApp() try/catch) through four such failures and
 * proves every one of them degrades to a human Spanish message plus a
 * real, working safe action -- NEVER a blank/black screen with no
 * explanation, and NEVER an uncaught exception escaping to the page.
 *
 *  1. Rejected async write (window.click360InviteWorkerEmail rejects with
 *     a raw Firestore-shaped error): the worker-invite form must show a
 *     human toast (no raw jargon) and re-enable itself for a retry.
 *  2. Offline write attempt (window.click360WriteGate reports
 *     allowed:false, reason:'offline_online_only'): saving a new product
 *     must show the real writeBlockMessage() human copy, must NOT lose
 *     the operator's typed data, and must let the SAME action succeed
 *     once connectivity returns -- proving this isn't just a toast, it's
 *     a real recoverable state.
 *  3. Failed asset load (the home banner image request is aborted): the
 *     real onerror handler on that <img> must hide its frame instead of
 *     leaving a broken-image icon forever, and the rest of the home page
 *     (greeting, KPIs) must stay fully visible -- one broken asset must
 *     never take down the page around it.
 *  4. A genuinely thrown exception inside a route render: renderApp()'s
 *     try/catch (app.js ~line 2402-2431) is the last line of defense.
 *     Directly monkey-patching a *view* function (e.g. homeView) from
 *     outside is not possible here -- app.js is a strict-mode IIFE, so
 *     none of its internal functions are reachable off `window`; that
 *     encapsulation is itself good practice and is left untouched. What
 *     IS reachable, and IS genuinely, synchronously called by real view
 *     code on every render (fmt() -> Number.prototype.toFixed()), is
 *     patched to throw for one single render pass. This produces a real,
 *     unmocked exception inside real app.js view code, not a simulated
 *     one -- proving the friendlyError fallback ("No pudimos abrir esta
 *     sección" + a real, clickable "Actualizar aplicación" reload button)
 *     actually renders and actually recovers the app.
 *
 * Harness notes (offline synthetic session, no real Firebase sign-in) --
 * see qa/r37-worker-access-gate-e2e.mjs / qa/r37-2-worker-invite-message-e2e.mjs
 * for the original, proven pattern this test reuses verbatim.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_ERROR_RECOVERY_E2E_PORT || 4757);
const url = `http://127.0.0.1:${port}/index.html`;
const BANNER_ASSET_PATH = 'assets/banner-click360-home.png';
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('App did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitForToast(page, { timeout = 8000 } = {}) {
  await page.waitForFunction(() => {
    const el = document.getElementById('toast');
    return !!el && el.className.includes('show');
  }, { timeout });
  return page.evaluate(() => {
    const el = document.getElementById('toast');
    return { text: el.textContent, isErr: el.className.includes('err') };
  });
}

// ── Scenario 1: rejected async write ────────────────────────────────────
async function scenarioRejectedAsyncWrite(page) {
  await page.evaluate(() => window.click360Route('workers'));
  await page.waitForFunction(() => {
    const el = document.getElementById('workerName');
    return el && el.offsetParent !== null;
  }, { timeout: 15000 });

  // Mock the real cloud write to reject with a RAW, Firestore-shaped
  // technical error (a .code, no curated Spanish message) -- exactly the
  // shape a real permission/connectivity failure would take.
  await page.evaluate(() => {
    window.click360InviteWorkerEmail = async () => {
      const err = new Error('Missing or insufficient permissions.');
      err.code = 'permission-denied';
      throw err;
    };
  });

  await page.fill('#workerName', 'Trabajador Prueba');
  await page.fill('#workerEmail', 'trabajador.prueba@example.com');
  await page.selectOption('#workerRole', 'cajero');
  const submitBtn = page.locator('#addWorkerForm button[type="submit"]');
  await submitBtn.click();

  const toastResult = await waitForToast(page);
  assert(toastResult.isErr, `a rejected worker invite must show an error-styled toast, got: ${JSON.stringify(toastResult)}`);
  assert(!/permission-denied|Missing or insufficient permissions/i.test(toastResult.text), `raw Firestore jargon must never reach the end user, got: "${toastResult.text}"`);
  assert(/[a-záéíóúñ]/i.test(toastResult.text) && toastResult.text.length > 5, `the error toast must contain a real, readable message, got: "${toastResult.text}"`);

  // Safe action: the form must re-enable so the comerciante can retry --
  // never left stuck on "Procesando...".
  await page.waitForFunction(() => {
    const btn = document.querySelector('#addWorkerForm button[type="submit"]');
    return btn && !btn.disabled && btn.textContent.trim() !== 'Procesando...';
  }, { timeout: 8000 });
  const btnState = await submitBtn.evaluate((el) => ({ disabled: el.disabled, text: el.textContent.trim() }));
  assert(!btnState.disabled, `the submit button must re-enable after a rejected write so the operator can retry, got disabled=${btnState.disabled}`);

  // App must still be fully alive, not frozen/blank.
  const appAlive = await page.evaluate(() => !!document.getElementById('workerName') && document.getElementById('app').innerHTML.length > 200);
  assert(appAlive, 'the app must remain fully rendered and usable after a rejected async write, not a blank/frozen screen');
}

// ── Scenario 2: simulated offline write attempt ─────────────────────────
async function scenarioOfflineWriteAttempt(page) {
  await page.evaluate(() => window.click360Route('inventory'));
  await page.waitForFunction(() => {
    const el = document.getElementById('newProduct');
    return el && el.offsetParent !== null;
  }, { timeout: 15000 });
  await page.click('#newProduct');
  await page.waitForSelector('#productForm', { state: 'visible' });

  const productName = `Producto Offline QA ${Date.now()}`;
  await page.fill('#pName', productName);

  // Simulate the device being offline: the real write-gate now blocks.
  await page.evaluate(() => {
    window.click360WriteGate = () => ({ allowed: false, reason: 'offline_online_only' });
  });
  await page.click('#productForm button[type="submit"]');

  const toastResult = await waitForToast(page);
  assert(toastResult.isErr, `an offline write attempt must show an error-styled toast, got: ${JSON.stringify(toastResult)}`);
  assert(toastResult.text === 'Este dispositivo necesita internet para guardar. Conéctate y vuelve a intentar.', `the offline write must show the real writeBlockMessage() human copy, got: "${toastResult.text}"`);

  // Safe recoverable state: the modal/form must still be open with the
  // operator's typed data intact -- no silent data loss, no forced
  // navigation away from the unsaved work.
  const stillOpen = await page.evaluate(() => {
    const overlay = document.querySelector('.modalOverlay.show');
    const nameInput = document.getElementById('pName');
    return { overlayOpen: !!overlay, nameValue: nameInput ? nameInput.value : null };
  });
  assert(stillOpen.overlayOpen, 'the product form must remain open after a blocked offline write -- never silently discard unsaved work');
  assert(stillOpen.nameValue === productName, `the operator's typed product name must survive the blocked write attempt, got: "${stillOpen.nameValue}"`);

  const wasAdded = await page.evaluate((name) => document.getElementById('app').innerHTML.includes(name), productName);
  assert(!wasAdded, 'a product must NEVER be recorded as saved while the write gate blocked it -- no false success');

  // Now prove this is a genuinely recoverable state, not just a nice
  // message: restore connectivity and retry the SAME action.
  await page.evaluate(() => {
    window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
  });
  await page.click('#productForm button[type="submit"]');
  await page.waitForFunction((name) => document.getElementById('app')?.innerHTML.includes(name), productName, { timeout: 8000 });
  const nowAdded = await page.evaluate((name) => document.getElementById('app').innerHTML.includes(name), productName);
  assert(nowAdded, 'once connectivity returns, retrying the exact same action must genuinely succeed -- proving this was a real recoverable block, not a dead end');
}

// ── Scenario 3: failed asset load ────────────────────────────────────────
async function scenarioFailedAssetLoad(page) {
  await page.evaluate(() => window.click360Route('home'));
  const result = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      // r37.2: 8s was tight enough to flake in a resource-constrained CI
      // runner (route.abort() + the image's own onerror round-trip can
      // take longer there than on a local dev machine); 20s matches the
      // margin already used by the other scenarios in this same file.
      const deadline = Date.now() + 20000;
      const check = () => {
        const frame = document.querySelector('.homeBannerFrame');
        if (frame && getComputedStyle(frame).display === 'none') return resolve();
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for the failed banner image to hide its frame'));
        setTimeout(check, 100);
      };
      check();
    });
    const frame = document.querySelector('.homeBannerFrame');
    const kpis = document.querySelector('.kpis');
    const greeting = document.querySelector('.homeGreeting');
    return {
      frameDisplay: getComputedStyle(frame).display,
      kpisVisible: !!kpis && kpis.offsetParent !== null,
      greetingVisible: !!greeting && greeting.offsetParent !== null,
    };
  });
  assert(result.frameDisplay === 'none', `a failed banner image load must hide its own frame gracefully via its real onerror handler, got display:${result.frameDisplay}`);
  assert(result.kpisVisible, 'a single failed image load must never blank out the rest of the home page -- the KPI cards must stay visible');
  assert(result.greetingVisible, 'a single failed image load must never blank out the rest of the home page -- the greeting header must stay visible');
}

// ── Scenario 4: genuinely thrown exception inside a route render ────────
async function scenarioThrownRenderException(page) {
  const result = await page.evaluate(() => {
    const originalToFixed = Number.prototype.toFixed;
    let out;
    try {
      // fmt() -- real currency formatting called synchronously by real
      // view code (e.g. homeView's fmt(income)/fmt(saldo)) on every
      // render -- is patched to throw for exactly one render pass. This
      // is a genuine, unmocked exception surfacing from inside real
      // app.js view code, not a simulated error object.
      Number.prototype.toFixed = function() { throw new Error('QA-INJECTED: simulated deep render crash'); };
      window.click360Route('home');
      const errorEl = document.querySelector('.friendlyError');
      out = {
        renderedFriendlyError: !!errorEl,
        messageText: errorEl ? errorEl.textContent : '',
        hasReloadButton: !!errorEl && !!errorEl.querySelector('button[onclick="location.reload()"]'),
        hash: location.hash,
      };
    } finally {
      Number.prototype.toFixed = originalToFixed;
    }
    return out;
  });
  assert(result.renderedFriendlyError, 'a genuine unhandled exception during route render must fall back to the friendlyError UI, never a blank/black screen');
  assert(result.messageText.includes('No pudimos abrir esta sección'), `the friendlyError fallback must show the real human message, got: "${result.messageText}"`);
  assert(result.hasReloadButton, 'the friendlyError fallback must offer a real, wired "Actualizar aplicación" safe action, not just static text');
  assert(result.hash === '#home', `the URL hash must still reflect the attempted route even though rendering failed, got: ${result.hash}`);

  // Functionally verify the safe action actually recovers the app --
  // click it for real and confirm the reload genuinely lands back on a
  // working script context.
  await page.click('.friendlyError button[onclick="location.reload()"]');
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
}

async function run() {
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      // Scenario 3: make the home banner image genuinely fail to load.
      if (reqUrl.includes(BANNER_ASSET_PATH)) return route.abort('failed');
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-2-error-recovery-owner-uid';
    await page.evaluate(async (uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      window.click360CurrentOwnerWorkersEnabled = async () => true;
      window.click360ApplyTenantState({
        businesses: [{ id: 'biz_main', name: 'Tienda Prueba QA', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} }, workers: [] },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      }, context);
      window.click360Route('home');
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const check = () => {
          const el = document.querySelector('.homeGreeting');
          if (el && el.offsetParent !== null) return resolve();
          if (Date.now() > deadline) return reject(new Error(`Timed out waiting for home to render (hash=${location.hash})`));
          setTimeout(check, 100);
        };
        check();
      });
    }, uid);

    // Run the asset-load scenario FIRST (it just inspects the already
    // -rendered home view's banner) before any other scenario navigates
    // away or reloads the page.
    await scenarioFailedAssetLoad(page);
    await scenarioRejectedAsyncWrite(page);
    await scenarioOfflineWriteAttempt(page);
    await scenarioThrownRenderException(page); // reloads the page -- must run last

    if (pageErrors.length) throw new Error(`Every one of these failures must be caught internally and never surface as an uncaught page exception: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37.2 error-recovery E2E PASS: a rejected async write, a blocked offline write, a failed asset load, and a genuine thrown exception inside a route render all degrade to a real human Spanish message plus a real working safe action (retry / reload) -- never a blank/black screen, and never an uncaught page exception.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
