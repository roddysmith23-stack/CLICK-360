import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (real bugs found during certification -- qa/r37-2-restaurant-e2e.mjs
 * discovered and reported these; this test proves both are now fixed):
 *
 *  1. TAX BUG (financial correctness): "Cobrar mesa" used to display/default/
 *     validate against a raw pre-tax total (tableOrderTotal()) while the
 *     actual charge (finalizeTableCharge()) computed a SEPARATE tax-inclusive
 *     total via calculateCart() -- when a business has tax enabled with
 *     priceMode 'excluded' (menu prices shown pre-tax, common in LatAm),
 *     the cashier saw/validated a lower number than what actually got
 *     booked, silently under-collecting. Both paths now share one
 *     tableOrderChargeTotal() helper (app.js) so they can never diverge.
 *  2. RESIZE STEPPER BUG: the "+/-" table-resize buttons (data-table-grow/
 *     data-table-shrink) were silently non-functional for a real click while
 *     "Editar plano" was on, because the ancestor pointerdown handler called
 *     preventDefault() unconditionally, suppressing the browser's
 *     synthesized click for the buttons themselves.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_RESTAURANT_TAX_RESIZE_E2E_PORT || 4750);
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
    await waitForServer();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-2-restaurant-tax-resize-uid';
    await page.evaluate(async (uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      Object.defineProperty(window, 'click360User', {
        configurable: true,
        get() { return this.__u; },
        set(value) { if (value != null) this.__u = value; }
      });
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      window.click360ApplyTenantState({
        // A restaurant with tax enabled, priceMode 'excluded' -- menu prices
        // shown pre-tax, 12% added on top. This is the exact real scenario
        // the reported bug requires to manifest.
        businesses: [{ id: 'biz_main', name: 'Restaurante Real', status: 'activo', type: 'restaurante', settings: { tax: { enabled: true, rate: 12, priceMode: 'excluded' } } }],
        activeBusinessId: 'biz_main',
        products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Plato Real', qty: 20, stock: 20, price: 10, cardPrice: 10, taxMode: 'inherit' }],
        sales: [], movements: [], cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: new Date().toISOString().slice(0, 10), status: 'open', openedBy: 'Owner', openedAt: new Date().toISOString() }],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [{ id: 'table1', businessId: 'biz_main', name: 'Mesa 1', status: 'free', layout: { x: 10, y: 10, width: 18, height: 18 } }],
        tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} } },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      }, context);
      window.click360Route('tables');
    }, uid);

    await page.waitForSelector('#tableMap [data-table-open="table1"]', { timeout: 15000 });

    // ── Bug #1 (TAX): open Mesa 1, add the $10 item, charge it, and confirm
    // the checkout modal shows/validates the TAX-INCLUSIVE $11.20, not the
    // raw pre-tax $10.00 -- and that the actual sale recorded also books
    // $11.20 (the two paths can no longer diverge). ──
    await page.click('#tableMap [data-table-open="table1"]');
    await page.waitForSelector('#tableAddItemForm', { timeout: 10000 });
    await page.selectOption('#tableProduct', 'p1');
    await page.fill('#tableQty', '1');
    await page.click('#tableAddItemForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.tableOrderSummary')?.textContent.includes('Plato Real'), { timeout: 10000 });

    await page.click('#tableChargeBtn');
    await page.waitForSelector('#tableCheckoutForm', { timeout: 10000 });
    const displayedTotal = await page.$eval('#tableCheckoutTotal', (el) => el.textContent);
    assert(displayedTotal.includes('11.20') || displayedTotal.includes('11,20'), `the checkout modal must display the REAL tax-inclusive total ($11.20 = $10 + 12% IVA), got "${displayedTotal}" -- this is the exact reported bug: showing the pre-tax $10.00 instead`);
    const tenderedDefault = await page.$eval('#tableCheckoutTendered', (el) => el.value);
    assert(Number(tenderedDefault).toFixed(2) === '11.20', `the "Efectivo recibido" default must also be the tax-inclusive $11.20, got ${tenderedDefault}`);

    // Try to under-tender exactly the PRE-TAX amount -- must now be rejected
    // (before the fix, this would have been silently accepted as "exact").
    await page.fill('#tableCheckoutTendered', '10.00');
    await page.click('#tableCheckoutForm button[type="submit"]');
    const rejectedUnderTender = await page.evaluate(() => document.getElementById('tableCheckoutForm') !== null);
    assert(rejectedUnderTender, 'tendering only the pre-tax $10.00 must be REJECTED (insufficient) -- the checkout form must still be open, not silently accepted as a full payment');

    await page.fill('#tableCheckoutTendered', '11.20');
    await page.click('#tableCheckoutForm button[type="submit"]');
    await page.waitForFunction(() => location.hash === '#tables', { timeout: 15000 });

    const finalState = await page.evaluate(() => window.click360GetTenantState());
    const sale = finalState.sales.find((s) => s.tableId === 'table1');
    assert(sale, 'the table charge must have produced a real sale');
    assert(Math.abs(Number(sale.total) - 11.2) < 0.001, `the actual recorded sale must total $11.20 (matching what was displayed/validated), got ${sale.total}`);

    // ── Bug #2 (RESIZE STEPPER): a real click on the grow button while in
    // Editar plano mode must now actually resize the table. ──
    // The post-charge receipt modal opens on a setTimeout(...,0), so wait
    // for it to actually appear, then do a full real re-navigation (not a
    // hand-cleared DOM patch, which can leave stale overlay remnants) to
    // get back to a clean #tables render.
    await page.waitForFunction(() => document.body.classList.contains('has-modal'), { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.click360CloseModal?.(); window.click360Route('tables'); });
    await page.waitForSelector('#toggleTableLayout', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(150);
    await page.click('#toggleTableLayout');
    await page.waitForSelector('#tableMap.editing', { timeout: 5000 });
    const widthBefore = await page.evaluate(() => window.click360GetTenantState().tables.find((t) => t.id === 'table1').layout.width);
    await page.click('[data-table-grow="table1"]');
    await page.waitForTimeout(150);
    const widthAfter = await page.evaluate(() => window.click360GetTenantState().tables.find((t) => t.id === 'table1').layout.width);
    assert(widthAfter > widthBefore, `a real click on the grow (+) stepper button must actually resize the table (widthBefore=${widthBefore}, widthAfter=${widthAfter}) -- this is the exact reported bug: the button silently doing nothing`);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 restaurant checkout-tax + resize-stepper PASS: "Cobrar mesa" now displays/validates/charges the SAME real tax-inclusive total (no more silent under-collection), and the "+/-" resize stepper buttons work for a real click while in Editar plano mode.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
