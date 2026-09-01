import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (mission section 16, "RESTAURANTE E2E"): there was NO browser E2E
 * test for the restaurant flow at all (no qa/*restaurant*, *kitchen*, *kds*
 * or *table* file existed before this one). This drives the REAL app.js
 * "Mesas" / "Cocina" / "Barra" UI end to end -- real DOM clicks, real
 * form fills, real button handlers -- through:
 *
 *  1. Editar plano: toggling layout-edit mode via a real click (entry point
 *     works). A REAL bug was found and reported separately (not fixed here
 *     per instructions -- see the QA report for exact file:line + repro):
 *     the "+/-" resize stepper buttons (data-table-grow/data-table-shrink)
 *     are silently non-functional for a real mouse/touch user while edit
 *     mode is on, because the ancestor .tableMapItem's pointerdown handler
 *     calls event.preventDefault() for any target other than .tableStyleBtn
 *     -- which, per the Pointer Events spec, suppresses the browser's
 *     synthesized compatibility click event, so the buttons' own onclick
 *     handlers never fire. Confirmed live: a realistic Playwright
 *     page.click() on the stepper produces zero state change, while a raw
 *     element.click() DOM call (which bypasses pointerdown entirely) does
 *     mutate table.layout correctly -- proving the button's own logic is
 *     fine and the regression is purely the ancestor's overly-broad
 *     preventDefault(). This test therefore only exercises the parts of
 *     "moving/editing a table" that actually work for a real user today.
 *  2. Abrir mesa -> agregar un producto de inventario + un consumo directo
 *     (no-inventory) in two different areas (cocina/barra) -> Enviar a
 *     cocina.
 *  3. The KDS boards: the SAME pedido must appear on BOTH /kitchen (its
 *     cocina item) and /bar (its barra item) -- proving area-based routing
 *     -- and marking it "Listo" from the kitchen board must be reflected
 *     immediately on the bar board too (shared order state, not two copies).
 *  4. Cobrar mesa, while the device is genuinely offline (real Playwright
 *     network-layer offline, not just a flag -- the same proven technique
 *     as qa/r37-offline-sale-e2e.mjs), including a REAL double-submit of
 *     the checkout form (two synchronous form.requestSubmit() calls, which
 *     is what a fast double-tap collapses to once the JS event loop is
 *     involved) to prove the "Confirmar cobro" button's own disabled-guard
 *     actually prevents a duplicate charge -- not just in theory.
 *  5. Coherence: after charging, exactly ONE sale, exactly ONE stock
 *     decrement (nonInventory items must NOT touch stock), exactly ONE cash
 *     movement, the order is 'paid', the table is 'free' again, and the
 *     real post-charge receipt modal (#printReceiptBtn) is reachable --
 *     proving "printing" is wired from the table-charge flow, not just the
 *     regular POS sale flow.
 *
 * Harness notes (offline synthetic session, no real Firebase sign-in -- see
 * the other r37/r37.2 E2E tests for the same pattern):
 *  - Outbound network is restricted to the local static server so the real
 *    Firebase Auth SDK never resolves a background "user=null" a few
 *    seconds in, which would otherwise wipe #app or trigger a hidden
 *    auth-gate form submit.
 *  - window.click360WriteGate is overridden to allowed:true -- this is the
 *    one exposed seam for firebase-service.js's real save() write-gate,
 *    which otherwise requires a real sign-in round trip. This is a
 *    CLIENT-SIDE UX gate only; real enforcement is firestore.rules,
 *    untouched here.
 *  - window.click360User is pinned via a getter/setter (not a plain
 *    assignment): firebase-service.js's real auth.onAuthStateChanged
 *    listener (registered at module load, unmockable) resolves to
 *    user=null in the background -- timing varies run to run -- and its
 *    deactivateActiveAccount() does `window.click360User = null` directly
 *    (firebase-service.js ~3538), independent of the click360ClearTenant
 *    Context no-op above. A plain assignment here loses that race
 *    intermittently (save() then throws "El acceso operativo... pausado"
 *    because isOwnerUser() reads a null user), which is exactly what a
 *    first version of this test flaked on. Pinning the property is the
 *    deterministic fix.
 *  - Restaurant module visibility (tablesView/kitchenBoardView) is gated by
 *    business.type + the static p2-web-safe-flags.js release flag
 *    (p2RestaurantAdvancedEnabled), which ships `true` -- both are real,
 *    unmocked code paths.
 *
 * Known gap found while building this (reported separately, not fixed
 * here per instructions -- see the QA report for exact file:line): NO
 * "unir mesas" / merge-tables feature exists anywhere in app.js -- only
 * cosmetic table repositioning (drag/grow/shrink) exists. There is also no
 * partial-payment path for a table order (state.restaurantPayments is
 * seeded in every fixture/schema but is never read or written by any
 * function in app.js) -- a table order can only be charged for its full
 * total in one shot.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_RESTAURANT_E2E_PORT || 4749);
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

async function pollPage(page, predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(predicate)) return;
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-2-restaurant-owner-uid';
    await page.evaluate((uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      const nowIso = new Date().toISOString();
      // Cash-session dates are business-local, never UTC. The old UTC slice
      // crossed to tomorrow at 19:00 Ecuador and made this deterministic E2E
      // claim there was no open cash session even though one was seeded.
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      const businessCtx = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(businessCtx, { deferLocalLoad: true });
      // Pinned against the real onAuthStateChanged(null) race -- see the
      // top-of-file harness note.
      const fixedUser = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      Object.defineProperty(window, 'click360User', { configurable: true, get: () => fixedUser, set: () => {} });
      window.click360ApplyTenantState({
        businesses: [{ id: 'biz_main', name: 'Restaurante Real', status: 'activo', type: 'restaurante', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Hamburguesa Real', qty: 20, stock: 20, price: 8, cardPrice: 8, taxMode: 'inherit' }],
        sales: [], movements: [],
        cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: today, status: 'open', openedBy: 'Owner', openedAt: nowIso }],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [{ id: 'table1', businessId: 'biz_main', name: 'Mesa 1', seats: 4, partySize: 2, createdAt: nowIso, status: 'free' }],
        tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: nowIso, source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: nowIso, operationId: 'x', version: 16.2, checklist: {} } },
        updatedAtMs: Date.now(), updatedAt: nowIso
      }, businessCtx);
      window.click360Route('tables');
    }, uid);

    await page.waitForSelector('#tableMap [data-table-open="table1"]', { timeout: 15000 });

    // ── 1. Editar plano: toggle layout-edit mode via a real click ──
    // (The "+/-" resize stepper itself is broken for real clicks while in
    // this mode -- see the top-of-file note and the QA report. Not
    // asserted here since it does not currently work for a real user; the
    // toggle entry point below does.)
    await page.click('#toggleTableLayout');
    await page.waitForSelector('#tableMap.editing', { timeout: 5000 });
    await page.click('#toggleTableLayout');
    await page.waitForSelector('#tableMap:not(.editing)', { timeout: 5000 });

    // ── 2. Abrir mesa, agregar un producto de inventario + un consumo directo ──
    await page.click('#tableMap [data-table-open="table1"]');
    await page.waitForSelector('#tableAddItemForm', { timeout: 10000 });
    await page.selectOption('#tableProduct', 'p1');
    await page.fill('#tableQty', '2');
    await page.click('#tableAddItemForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.tableOrderSummary')?.textContent.includes('Hamburguesa Real'), { timeout: 10000 });

    await page.fill('#tableQuickName', 'Refresco especial');
    await page.fill('#tableQuickPrice', '5');
    await page.fill('#tableQuickQty', '1');
    await page.selectOption('#tableQuickArea', 'bar');
    await page.click('#tableQuickItemForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.tableOrderSummary')?.textContent.includes('Refresco especial'), { timeout: 10000 });

    const summaryAfterItems = await page.$eval('.tableOrderSummary', (el) => el.textContent);
    assert(summaryAfterItems.includes('Hamburguesa Real') && summaryAfterItems.includes('Refresco especial'), 'both the inventory item and the direct (non-inventory) item must appear in the real order summary DOM');
    const totalAfterItems = await page.$eval('.tableOrderTotal strong', (el) => el.textContent);
    assert(totalAfterItems === '$21.00', `order total must reflect 2x$8 (inventory) + 1x$5 (direct) = $21.00, got ${totalAfterItems}`);

    // ── 3. Enviar a cocina ──
    await page.click('#tableSendKitchenBtn');
    await page.waitForFunction(() => document.querySelector('.tableOrderStatusStrip')?.textContent.includes('Preparando'), { timeout: 10000 });
    const orderIdAfterSend = await page.evaluate(() => window.click360GetTenantState().tableOrders.find((o) => o.tableId === 'table1')?.id);
    assert(orderIdAfterSend, 'sending to kitchen must be reflected in real tableOrders state');

    await page.click('.closeBtn[data-close]');
    await page.waitForFunction(() => !document.body.classList.contains('has-modal'), { timeout: 5000 });

    // ── 4. KDS: the SAME pedido shows on BOTH /kitchen (cocina item) and /bar (barra item) ──
    await page.evaluate(() => window.click360Route('kitchen'));
    await page.waitForSelector('.kitchenTicket', { timeout: 10000 });
    const kitchenTicketText = await page.$eval('.kitchenTicket', (el) => el.textContent);
    assert(kitchenTicketText.includes('Mesa 1') && kitchenTicketText.includes('Hamburguesa Real') && kitchenTicketText.includes('2×'), `the kitchen board must show Mesa 1's cocina item (2x Hamburguesa Real), got: ${kitchenTicketText}`);
    assert(!kitchenTicketText.includes('Refresco especial'), 'the kitchen (cocina) board must NOT show the barra-area item');

    await page.evaluate(() => window.click360Route('bar'));
    await page.waitForSelector('.kitchenTicket', { timeout: 10000 });
    const barTicketTextBefore = await page.$eval('.kitchenTicket', (el) => el.textContent);
    assert(barTicketTextBefore.includes('Mesa 1') && barTicketTextBefore.includes('Refresco especial') && barTicketTextBefore.includes('1×'), `the bar board must show Mesa 1's barra item (1x Refresco especial), got: ${barTicketTextBefore}`);
    assert(!barTicketTextBefore.includes('Hamburguesa Real'), 'the bar (barra) board must NOT show the cocina-area item');

    // Mark ready from the KITCHEN board; the BAR board (same order, different
    // view) must reflect it too -- shared order state, not two independent copies.
    await page.evaluate(() => window.click360Route('kitchen'));
    await page.waitForSelector('.kitchenTicket', { timeout: 10000 });
    await page.click('[data-kitchen-status][data-kitchen-next="ready"]');
    await page.waitForFunction(() => document.querySelector('.kitchenTicket')?.textContent.includes('Por cobrar'), { timeout: 10000 });

    await page.evaluate(() => window.click360Route('bar'));
    await page.waitForSelector('.kitchenTicket', { timeout: 10000 });
    const barTicketTextAfter = await page.$eval('.kitchenTicket', (el) => el.textContent);
    assert(barTicketTextAfter.includes('Por cobrar'), `marking the order "Listo" from the kitchen board must also be visible on the bar board for the SAME order (shared state), got: ${barTicketTextAfter}`);

    const readyState = await page.evaluate(() => window.click360GetTenantState());
    const readyOrder = readyState.tableOrders.find((o) => o.id === orderIdAfterSend);
    assert(readyOrder.readyToCharge === true && readyOrder.kitchenStatus === 'ready', 'the real order object must be readyToCharge + kitchenStatus=ready after marking it Listo');

    // ── 5. Cobrar mesa while genuinely offline (real network-layer offline), ──
    //      including a real double-submit of the checkout form.
    await context.setOffline(true);
    await page.evaluate(() => window.click360Route('tables'));
    await page.waitForSelector('#tableMap [data-table-open="table1"]', { timeout: 10000 });
    await page.click('#tableMap [data-table-open="table1"]');
    await page.waitForSelector('#tableChargeBtn:not([disabled])', { timeout: 10000 });
    await page.click('#tableChargeBtn');
    try {
      await page.waitForSelector('#tableCheckoutForm', { timeout: 10000 });
    } catch (error) {
      const diagnostics = await page.evaluate((expectedOrderId) => ({
        hash: location.hash,
        online: navigator.onLine,
        hydrated: window.click360IsTenantDataHydrated?.(),
        modalText: document.querySelector('#modalRoot')?.textContent?.slice(0, 500) || '',
        toast: document.querySelector('#toast')?.textContent || '',
        openCash: window.click360GetTenantState?.().cashSessions?.filter((item) => item.status === 'open') || [],
        order: window.click360GetTenantState?.().tableOrders?.find((item) => item.id === expectedOrderId) || null
      }), orderIdAfterSend);
      throw new Error(`table checkout did not open: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
    const checkoutTotalText = await page.$eval('.tableCheckoutSummary strong', (el) => el.textContent);
    assert(checkoutTotalText === '$21.00', `the checkout modal must show the same real total ($21.00), got ${checkoutTotalText}`);

    const dispatch = await page.evaluate(() => {
      const form = document.getElementById('tableCheckoutForm');
      const btn = form.querySelector('button[type="submit"]');
      const disabledBefore = btn.disabled;
      form.requestSubmit(); // first real submit -> synchronously pushes the sale, decrements stock, pushes the movement, and disables the button before yielding to the microtask queue
      const disabledRightAfterFirst = btn.disabled;
      form.requestSubmit(); // a genuine fast double-tap collapses to this: a second submit dispatched before the first async continuation runs
      return { disabledBefore, disabledRightAfterFirst };
    });
    assert(dispatch.disabledBefore === false, 'the "Confirmar cobro" button must start enabled');
    assert(dispatch.disabledRightAfterFirst === true, 'the "Confirmar cobro" button must be synchronously disabled by the first submit, BEFORE a second (double-tap) submit can go through -- this is the real double-charge protection');

    await pollPage(page, () => location.hash === '#tables', 'route to return to #tables after the offline table charge settles', 20000);
    await context.setOffline(false);

    const finalState = await page.evaluate(() => window.click360GetTenantState());
    const salesForOrder = finalState.sales.filter((s) => s.tableOrderId === orderIdAfterSend);
    assert(salesForOrder.length === 1, `exactly ONE sale must be created for the table order even after a double-submit, got ${salesForOrder.length}`);
    assert(salesForOrder[0].total === 21, `the recorded sale total must be $21.00, got ${salesForOrder[0].total}`);
    assert(salesForOrder[0].items.length === 2, `the sale must carry both real line items, got ${salesForOrder[0].items.length}`);

    const movementsForSale = finalState.movements.filter((m) => m.saleId === salesForOrder[0].id);
    assert(movementsForSale.length === 1, `exactly ONE cash movement must be produced by the table charge, got ${movementsForSale.length}`);
    assert(movementsForSale[0].kind === 'ingreso' && movementsForSale[0].amount === 21, `the cash movement must be a single $21.00 ingreso, got ${JSON.stringify(movementsForSale[0])}`);

    const finalProduct = finalState.products.find((p) => p.id === 'p1');
    assert(finalProduct.stock === 18, `stock must be decremented EXACTLY once for the 2 units sold (20 -> 18), never double-decremented by the double-submit, got ${finalProduct.stock}`);
    assert(finalProduct.qty === 18, `product.qty must mirror stock exactly (18), got ${finalProduct.qty}`);

    const finalOrder = finalState.tableOrders.find((o) => o.id === orderIdAfterSend);
    assert(finalOrder.status === 'paid', `the table order must end up 'paid', got ${finalOrder.status}`);
    const finalTable = finalState.tables.find((t) => t.id === 'table1');
    assert(finalTable.status === 'free', `Mesa 1 must be freed after charging, got ${finalTable.status}`);

    // Post-charge receipt/print path must be reachable from the table-charge
    // flow (checkout defaulted to "Abrir comprobante listo para imprimir").
    await page.waitForSelector('#printReceiptBtn', { timeout: 10000 });

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 restaurant E2E PASS: real Editar-plano toggle, abrir mesa + inventory/direct items across cocina+barra, sent-to-cocina, KDS state shared correctly between the /kitchen and /bar boards, an offline table charge with a real double-submit produces exactly ONE sale/ONE stock decrement/ONE cash movement (double-charge protection verified against the real button), Mesa 1 is freed, and the post-charge receipt/print modal is reachable.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
