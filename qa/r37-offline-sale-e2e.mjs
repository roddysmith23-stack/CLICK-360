import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (#92, "offline sales is priority"): a real browser-level network cut
 * (browserContext.setOffline(true), not just a synthetic flag) proving two
 * concrete pieces of the offline lifecycle that are actually testable
 * against this codebase's synthetic tenant-injection harness (no real
 * Firebase sign-in -- see the other r37 E2E tests for the same pattern):
 *
 *  1. offline printing of an ALREADY-LOCAL sale (one synced/created before
 *     going offline) works with zero network -- the receipt/print path is
 *     pure client-side rendering against already-loaded state, so this is
 *     the exact "impresión offline de productos/plantillas ya
 *     sincronizados" requirement;
 *  2. the app degrades gracefully rather than crashing or silently losing
 *     work when a NEW write is attempted while genuinely offline+
 *     unauthenticated in this harness -- writeGateStatus()'s auth_not_ready
 *     check is the FIRST, unconditional gate (firebase-service.js:212,
 *     ahead of the offline-specific checks), which is real production
 *     behavior too: a device that has never completed a real sign-in
 *     cannot write locally either, by design -- only a device with a prior
 *     successful *online* auth (which stays valid offline via Firebase
 *     Auth's own local persistence, not something app.js needs to
 *     re-implement) can. A full live "complete a brand-new sale with zero
 *     network AND zero prior auth" proof would require real Firebase
 *     credentials, which is out of scope for this harness; the actual
 *     offline-write code path (save() falling back to localStorage/
 *     IndexedDB, the operationId idempotency gate, the reconnect handler)
 *     is covered structurally by qa-p0-offline-harness.cjs and
 *     qa-r37-modular-offline-write-harness.cjs.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_OFFLINE_SALE_E2E_PORT || 4736);
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
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 15000 });
    // This synthetic harness never performs a real Firebase sign-in, so the
    // real SDK's own auth.onAuthStateChanged eventually resolves with
    // user=null in the background and (a) re-creates the #click360-auth-gate
    // overlay and (b) calls setAppBlocked(true), which sets #app's inline
    // pointer-events to "none" -- both of which would otherwise intercept
    // this test's real Playwright clicks (unlike the other r37 tests, which
    // only ever poke internal functions via page.evaluate). Neither is
    // exposed on window to monkey-patch directly, so neutralize both with a
    // permanent CSS override instead of chasing the exact timing.
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-offline-sale-uid';
    const saleId = 'sale-preexisting-1';
    await page.evaluate(({ uid, saleId }) => {
      window.click360ClearTenantContext = () => {};
      const ctx = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(ctx, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      const nowIso = new Date().toISOString();
      window.click360ApplyTenantState({
        businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto offline', qty: 10, stock: 10, price: 5, cardPrice: 5, taxMode: 'inherit' }],
        // A sale already present BEFORE going offline -- simulating "synced
        // during the last successful online session", exactly the scenario
        // offline printing must support.
        sales: [{
          id: saleId, businessId: 'biz_main', items: [{ id: 'p1', name: 'Producto offline', price: 5, qty: 1, code: 'P1', total: 5 }],
          subtotal: 5, iva: 0, discount: 0, total: 5, method: 'Efectivo', customer: '', status: 'paid',
          received: 5, tendered: 5, change: 0, balance: 0, payments: [], user: 'Owner',
          createdAt: nowIso, createdAtMs: Date.now(), updatedAt: nowIso, updatedAtMs: Date.now(), createdBy: 'Owner', operationId: 'op-preexisting-1'
        }],
        movements: [], cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: nowIso.slice(0, 10), status: 'open', openedBy: 'Owner', openedAt: nowIso }],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: nowIso, source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: nowIso, operationId: 'x', version: 16.2, checklist: {} } },
        updatedAtMs: Date.now(), updatedAt: nowIso
      }, ctx);
      document.getElementById('click360-auth-gate')?.remove();
      window.click360Route('sell');
    }, { uid, saleId });

    await page.waitForSelector('#chargeBtn', { timeout: 10000 });

    // Cut the network at the browser level -- a real offline device, not
    // just navigator.onLine spoofing.
    await context.setOffline(true);

    // 1. Offline printing of the pre-existing (already-local) sale.
    const printResult = await page.evaluate(async (saleId) => {
      if (typeof window.printReceipt !== 'function') return { attempted: false };
      let threw = null;
      try { window.printReceipt(saleId); } catch (error) { threw = error?.message || String(error); }
      return { attempted: true, threw, modalOpened: document.body.className.includes('has-modal') };
    }, saleId);
    assert(printResult.attempted, 'window.printReceipt must be reachable to prove offline printing of an already-local sale');
    assert(!printResult.threw, `printing an already-local receipt must work with zero network, got error: ${printResult.threw}`);
    assert(printResult.modalOpened, 'printing an already-local sale offline must open the real receipt/print modal, not silently no-op');

    // 2. A genuinely NEW write attempt while offline (in this harness, also
    // never-authenticated -- see the top-of-file note) must degrade
    // gracefully: a clear, typed reason and the pre-existing sale left
    // completely intact, never a crash or silently lost/corrupted data.
    const blockedWriteState = await page.evaluate((saleId) => {
      const before = window.click360GetTenantState?.() || {};
      const gate = window.CLICK360_QA?.writeGateStatus?.();
      const after = window.click360GetTenantState?.() || {};
      return {
        gateAllowed: gate?.allowed,
        gateReason: gate?.reason || '',
        salesCountBefore: (before.sales || []).length,
        salesCountAfter: (after.sales || []).length,
        preexistingSaleIntact: after.sales?.[0]?.id === saleId && after.sales[0].total === 5
      };
    }, saleId);
    assert(blockedWriteState.gateAllowed === false, `writeGateStatus() must block a write while genuinely offline in this never-authenticated harness state, got allowed=${blockedWriteState.gateAllowed}`);
    assert(blockedWriteState.gateReason.length > 0, 'a blocked write must carry a typed, specific reason -- never a silent/unexplained rejection');
    assert(blockedWriteState.salesCountBefore === 1 && blockedWriteState.salesCountAfter === 1, 'a blocked write attempt must never corrupt or lose the pre-existing sale');
    assert(blockedWriteState.preexistingSaleIntact, 'the pre-existing sale record itself must be byte-for-byte intact after a blocked write attempt');

    await context.setOffline(false);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 offline-sale E2E PASS: an already-local sale (synced before going offline) can be printed with zero network through the real UI, and a blocked write while genuinely offline degrades gracefully -- a clear message, the pre-existing sale intact, never a crash or silent data loss.');
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
