import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 mission section 6 (OWNER COMPLETO -- RETAIL): a single continuous
 * Owner session -- producto -> inventario -> venta -> caja -> cliente ->
 * apartado -> abono -> reportes -> cambio de plan -- proving every step
 * writes real state and that a plan change (Basic -> Pro -> Business ->
 * downgrade) never touches a single business record ("sin borrar datos").
 *
 * Scope notes (deliberate, matching prior r37.2 test decisions):
 *  - Legal hard-gate and the onboarding modal are already covered by
 *    qa/r37-legal-acceptance-gate-e2e.mjs; this test seeds a completed
 *    onboarding/legal state and focuses on the untested "continuous
 *    multi-feature session" integration angle instead of re-covering them.
 *  - Worker invite and label printing already have dedicated, passing
 *    r37.2 E2E coverage (qa/r37-2-worker-invite-message-e2e.mjs,
 *    qa/r37-2-label-fit-to-screen-e2e.mjs); not duplicated here.
 *  - The real CEO Admin plan-change tool (click360CeoAdminApplyActivation)
 *    makes real Firestore calls and is staff-only -- it cannot run inside
 *    this offline, network-blocked harness. Instead this test exercises
 *    the REAL architectural contract: window.click360AccessState (plan/
 *    billing) is a completely separate global from the tenant business
 *    state applied via click360ApplyTenantState (products/sales/layaways/
 *    movements) -- a plan change can only ever mutate the former. This is
 *    the same seam the real CEO Admin tool writes through in production.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_OWNER_JOURNEY_E2E_PORT || 4751);
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
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-2-owner-journey-uid';
    await page.evaluate(async (uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      // The journey is intentionally network-blocked. Model a successful
      // cloud commit plus authoritative readback so every critical action
      // still has to satisfy its real remoteApplied material predicate.
      window.click360SyncNow = async () => true;
      window.click360RefreshNow = async () => true;
      // Same auth-race defense proven across every other r37.2 test this
      // session: the real (never-signed-in) Firebase Auth SDK can resolve
      // onAuthStateChanged(null) from local persistence alone and
      // deactivateActiveAccount() would null this out mid-test.
      Object.defineProperty(window, 'click360User', {
        configurable: true,
        get() { return this.__u; },
        set(value) { if (value != null) this.__u = value; }
      });
      const tenantContext = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(tenantContext, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner Real', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      // Basic plan, full write access, no trial banner -- a real paying
      // Basic-tier Owner starting a normal day.
      window.click360AccessState = { mode: 'paid_base', plan: 'base', planCode: 'base', status: 'active', billingStatus: 'active', readOnly: false, source: 'ceoAdmin' };
      window.click360ApplyTenantState({
        businesses: [{ id: 'biz_main', name: 'Comercial Real', status: 'activo', type: 'retail', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} }, workers: [] },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      }, tenantContext);
      window.click360Route('cash');
    }, uid);

    // ── Caja: Iniciar Jornada ──
    await page.waitForSelector('#apertureAmountInput', { timeout: 15000 });
    await page.fill('#apertureAmountInput', '50.00');
    await page.click('#startDayBtnCash');
    await page.waitForFunction(() => window.click360GetTenantState().cashSessions.some((s) => s.status === 'open'), { timeout: 10000 });

    // ── Inventario: crear producto ──
    await page.evaluate(() => window.click360Route('inventory'));
    await page.waitForSelector('#newProduct', { timeout: 10000 });
    await page.click('#newProduct');
    await page.waitForSelector('#productForm', { timeout: 10000 });
    await page.fill('#pCode', 'JORNADA-1');
    await page.fill('#pCat', 'General');
    await page.fill('#pName', 'Producto Jornada Real');
    await page.fill('#pQty', '20');
    await page.fill('#pCost', '5');
    await page.fill('#pPrice', '10');
    await page.fill('#pCardPrice', '10.5');
    await page.click('#productForm button[type="submit"]');
    await page.waitForFunction(() => window.click360GetTenantState().products.some((p) => p.code === 'JORNADA-1'), { timeout: 10000 });

    // ── Vender: venta de contado ──
    await page.evaluate(() => window.click360Route('sell'));
    await page.waitForSelector('#manualCode', { timeout: 10000 });
    await page.fill('#manualCode', 'JORNADA-1');
    await page.click('#addCode');
    await page.waitForFunction(() => document.getElementById('cartItems')?.textContent.includes('Producto Jornada Real'), { timeout: 10000 });
    await page.fill('#cashReceived', '10.00');
    await page.click('#chargeBtn');
    await page.waitForFunction(() => window.click360GetTenantState().sales.some((s) => s.method === 'Efectivo' && s.items.some((i) => i.code === 'JORNADA-1')), { timeout: 10000 });
    // A cash sale auto-opens a "Venta Completada" receipt modal on a
    // setTimeout(...,500) -- wait for it to actually appear, then close
    // it via its own real button, or it blocks the next interaction.
    await page.waitForSelector('#doneSaleBtn', { timeout: 10000 });
    await page.click('#doneSaleBtn');
    await page.waitForSelector('#doneSaleBtn', { state: 'detached', timeout: 10000 });

    // ── Vender: Apartado (cliente + abono inicial) ──
    await page.fill('#manualCode', 'JORNADA-1');
    await page.click('#addCode');
    await page.waitForFunction(() => document.getElementById('cartItems')?.textContent.includes('Producto Jornada Real'), { timeout: 10000 });
    await page.selectOption('#payMethod', 'Apartado');
    await page.waitForSelector('#layawayDueDateField', { state: 'visible', timeout: 5000 });
    await page.fill('#customer', 'Cliente Real');
    await page.fill('#customerCedula', '1712345678');
    await page.fill('#customerPhone', '593969399562');
    await page.check('#layawayTermsAccepted');
    await page.fill('#cashReceived', '3.00');
    await page.click('#chargeBtn');
    await page.waitForFunction(() => window.click360GetTenantState().layaways.some((l) => l.customerSnapshot?.name === 'Cliente Real'), { timeout: 10000 });

    const afterLayawayCreated = await page.evaluate(() => {
      const state = window.click360GetTenantState();
      const layaway = state.layaways.find((l) => l.customerSnapshot?.name === 'Cliente Real');
      const sale = state.sales.find((s) => s.id === layaway.saleId);
      return { layawayStatus: layaway.status, saleBalance: sale.balance, saleTotal: sale.total, saleId: sale.id };
    });
    assert(afterLayawayCreated.layawayStatus === 'partially_paid', `a layaway created with a partial initial abono must start "partially_paid", got "${afterLayawayCreated.layawayStatus}"`);
    assert(Math.abs(afterLayawayCreated.saleBalance - (afterLayawayCreated.saleTotal - 3)) < 0.001, `layaway sale balance must reflect the $3 initial abono, got ${afterLayawayCreated.saleBalance}`);

    // The Apartado also auto-opens a "Venta Completada" receipt modal --
    // close it first via its own real button.
    await page.waitForSelector('#doneSaleBtn', { timeout: 10000 });
    await page.click('#doneSaleBtn');
    await page.waitForSelector('#doneSaleBtn', { state: 'detached', timeout: 10000 });

    // ── Apartados: registrar un abono adicional ──
    await page.evaluate(() => window.click360Route('debtors'));
    await page.waitForSelector('.layawayRow', { timeout: 10000 });
    await page.click('.layawayRow button:has-text("Abonar")');
    await page.waitForSelector('#layawayPaymentAmount', { timeout: 10000 });
    await page.fill('#layawayPaymentAmount', '2.00');
    await page.click('#confirmLayawayPayment');
    await page.waitForFunction((saleId) => {
      const sale = window.click360GetTenantState().sales.find((s) => s.id === saleId);
      return sale && Math.abs(sale.received - 5) < 0.001;
    }, afterLayawayCreated.saleId, { timeout: 10000 });

    const afterAbono = await page.evaluate((saleId) => {
      const state = window.click360GetTenantState();
      const sale = state.sales.find((s) => s.id === saleId);
      const layaway = state.layaways.find((l) => l.saleId === saleId);
      return { saleBalance: sale.balance, saleReceived: sale.received, layawayStatus: layaway.status, paymentsCount: sale.payments.length };
    }, afterLayawayCreated.saleId);
    assert(Math.abs(afterAbono.saleReceived - 5) < 0.001, `after a $2 additional abono on top of the $3 initial one, received must be $5, got ${afterAbono.saleReceived}`);
    assert(Math.abs(afterAbono.saleBalance - (afterLayawayCreated.saleTotal - 5)) < 0.001, `balance must drop by the $2 abono, got ${afterAbono.saleBalance}`);
    assert(afterAbono.paymentsCount === 2, `the sale must now carry 2 real payment records (initial + abono), got ${afterAbono.paymentsCount}`);

    // ── Reportes: la jornada debe reflejarse sin errores ──
    await page.evaluate(() => window.click360Route('reports'));
    await page.waitForSelector('.pageHead', { timeout: 10000 });
    await page.waitForTimeout(200);

    // ── Cambio de plan: Basic -> Pro -> Business -> downgrade a Basic.
    // Snapshot every business-data array BEFORE any plan change, then
    // assert byte-for-byte identity after each one -- a plan change must
    // never delete/alter a single product, sale, layaway or movement. ──
    const snapshotBefore = await page.evaluate(() => {
      const s = window.click360GetTenantState();
      return JSON.stringify({ products: s.products, sales: s.sales, layaways: s.layaways, movements: s.movements, cashSessions: s.cashSessions });
    });
    assert(snapshotBefore.includes('JORNADA-1') && snapshotBefore.includes('Cliente Real'), 'sanity: the pre-plan-change snapshot must contain the real data just created');

    const planSteps = [
      { plan: 'pro', mode: 'paid_pro', label: 'PRO' },
      { plan: 'business', mode: 'paid_pro', label: 'BUSINESS' },
      { plan: 'base', mode: 'paid_base', label: 'BASE' }
    ];
    for (const step of planSteps) {
      await page.evaluate((s) => {
        window.click360AccessState = { mode: s.mode, plan: s.plan, planCode: s.plan, status: 'active', billingStatus: 'active', readOnly: false, source: 'ceoAdmin' };
        window.click360Route('access');
      }, step);
      await page.waitForFunction((label) => document.body.textContent.includes(`Plan ${label}`), step.label, { timeout: 10000 });
      const snapshotAfter = await page.evaluate(() => {
        const s = window.click360GetTenantState();
        return JSON.stringify({ products: s.products, sales: s.sales, layaways: s.layaways, movements: s.movements, cashSessions: s.cashSessions });
      });
      assert(snapshotAfter === snapshotBefore, `changing plan to ${step.plan} must NOT alter a single business record (sin borrar datos) -- state diverged from the pre-change snapshot`);
    }

    // Final sanity: after the full Basic->Pro->Business->downgrade cycle,
    // the Owner must still have full write access to their own data.
    const finalAccessReadOnly = await page.evaluate(() => window.click360GetEffectiveAccess().readOnly);
    assert(finalAccessReadOnly === false, 'after downgrading back to Basic, the Owner must retain full (non-read-only) access to their own data');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 Owner full-journey PASS: producto -> inventario -> venta de contado -> apartado con cliente -> abono adicional -> reportes, all writing real state end to end, and a full Basic->Pro->Business->downgrade plan-change cycle left every product/sale/layaway/movement/cashSession byte-for-byte unchanged.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
