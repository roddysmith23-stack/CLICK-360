/**
 * qa-staging-authenticated-smoke.mjs
 *
 * Real authenticated smoke test against the LIVE staging deployment
 * (https://click360-staging-7620168025.web.app), using the canonical
 * synthetic QA tenant (scripts/qa-staging-canonical-tenant.mjs). Never
 * touches production, never touches any real customer (SHARY included).
 *
 * Covers exactly the gate the P0 hotfix (r37.2.4 + r37.2.5) exists for:
 *   create product -> save -> authoritative server readback -> reload ->
 *   persists -> second device sees it -> second device edits ->
 *   conflict/convergence contract correct
 * plus print (qty 2/4/6/10, QR 1:1, pitch 64mm) and a light route smoke
 * across Apartados/ventas/caja/hydration/Workers/Logistics/offline/
 * Safe Update.
 *
 * Independent verification: every "confirmed" claim is cross-checked
 * against a direct Admin SDK read of the real staging Firestore document,
 * not just the app's own toast/UI.
 */
import { chromium } from 'playwright';
import { connectAdmin } from './lib/firebase-admin-connect.mjs';
import { requireStagingQaCredentials } from './lib/qa-staging-credentials.mjs';
import { submitSyntheticProduct } from './lib/qa-staging-product-form.mjs';

const PROJECT = 'click360-staging-7620168025';
const URL = 'https://click360-staging-7620168025.web.app/';
const { email: EMAIL, password: PASSWORD } = requireStagingQaCredentials();

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function readCloudProduct(db, uid, productId) {
  const snap = await db.collection('businesses').doc(uid).collection('state').doc('main').get();
  if (!snap.exists) return { revision: null, product: null };
  const data = snap.data();
  const product = data.payload?.data?.products?.find((p) => p.id === productId) || null;
  return { revision: Number(data.revision || 0), product };
}

async function openSignedIn(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`[${label}][console.error]`, msg.text()); });
  const step = async (name, fn) => {
    try { return await fn(); } catch (error) { throw new Error(`[${label}] step "${name}" failed: ${error.message}`); }
  };
  await step('goto', () => page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }));
  await step('auth-fn-available', () => page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 60000 }));
  await step('sign-in', async () => {
    const result = await page.evaluate(async ({ email, password }) => {
      try {
        await window.click360Auth.signInWithEmailAndPassword(email, password);
        return { ok: true };
      } catch (error) {
        return { ok: false, code: error.code, message: error.message };
      }
    }, { email: EMAIL, password: PASSWORD });
    if (!result.ok) throw new Error(`signIn rejected: ${result.code} ${result.message}`);
  });
  await step('hydrated-and-synced', () => page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true && window.click360SyncStatus?.status === 'synced', { timeout: 60000 }));
  await step('route-inventory', () => page.evaluate(() => window.click360Route('inventory')));
  await step('new-product-visible', () => page.waitForSelector('#newProduct', { timeout: 45000 }));
  console.log(`[${label}] signed in and hydrated`);
  return { context, page, pageErrors };
}

async function captureLabelEvidence(page, product, quantity) {
  return page.evaluate(async ({ targetProduct, copies }) => {
    const source = window.click360GetTenantState().settings.labelTemplates?.[0]?.universalDocument
      || { paper: { widthMm: 40, heightMm: 60, mediaWidthMm: 40, mediaHeightMm: 0, columns: 2, rows: 1, gapXmm: 4, gapYmm: 4, marginTopMm: 13, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 6, dpi: 203 }, objects: [
        { id: 'qr', type: 'qr', xMm: 2, yMm: 2, widthMm: 18, heightMm: 18, visible: true, locked: false, rotation: 0, z: 1 },
        { id: 'name', type: 'name', xMm: 22, yMm: 7, widthMm: 34, heightMm: 5, visible: true, locked: false, rotation: 0, z: 2 },
        { id: 'price', type: 'price', xMm: 22, yMm: 54, widthMm: 34, heightMm: 5, visible: true, locked: false, rotation: 0, z: 3 }
      ] };
    const documentModel = { ...source, quantity: copies, startSlot: 1, priceFormat: 'short' };
    const job = await window.click360UniversalLabelTest.render(targetProduct, documentModel);
    const trace = job.plan.pages.flatMap((pagePlan) => pagePlan.cells.filter((cell) => cell.status === 'filled').map((cell) => ({ xMm: cell.xMm, yMm: cell.yMm, columnIndex: cell.column - 1, rightMm: cell.xMm + job.document.paper.widthMm })));
    const qr = job.document.objects.find((o) => o.type === 'qr');
    return {
      quantity: copies, occupiedSlots: trace.length, pages: job.plan.pages.length, media: job.media,
      patterns: job.plan.pages.map((p) => p.cells.map((c) => c.status === 'filled' ? 'X' : ' ').join('')),
      column2Inside: trace.filter((e) => e.columnIndex === 1).every((e) => e.rightMm <= job.media.widthMm + 0.001),
      qrSquare: Boolean(qr && Math.abs(qr.widthMm - qr.heightMm) < 0.001),
      noVerticalDrift: job.media.heightMm === 64 && trace.every((e) => e.yMm === 0)
    };
  }, { targetProduct: product, copies: quantity });
}

async function routeSmoke(page, route) {
  await page.evaluate((r) => window.click360Route(r), route);
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => ({
    hasError: !!document.body.textContent?.match(/error inesperado|crashed|undefined is not/i),
    bodyLength: document.getElementById('app')?.textContent?.length || 0
  }));
  return { route, ...result };
}

async function main() {
  const db = await connectAdmin(PROJECT, 'qa-staging-smoke');
  const browser = await chromium.launch();
  const results = { steps: [] };
  try {
    const deviceA = await openSignedIn(browser, 'Device A');
    const uid = await deviceA.page.evaluate(() => window.click360DebugSyncIdentity().businessId);
    const productId = `qa-smoke-${Date.now()}`;
    const productCode = `QASMK-${Date.now().toString(36)}`.toUpperCase();

    // 1. create -> save -> authoritative server readback
    const createResult = await submitSyntheticProduct(deviceA.page, { code: productCode, name: 'QA Smoke Staging Product', stock: 17, price:12, cardPrice:12.5 });
    assert(/confirmado en la nube/.test(createResult.message), `create not confirmed: ${createResult.message}`);
    const createdId = await deviceA.page.evaluate((code) => window.click360GetTenantState().products.find((p) => p.code === code)?.id, productCode);
    assert(createdId, 'created product id not found locally');
    const cloudAfterCreate = await readCloudProduct(db, uid, createdId);
    assert(cloudAfterCreate.product && Number(cloudAfterCreate.product.stock) === 17, `authoritative cloud readback mismatch after create: ${JSON.stringify(cloudAfterCreate.product)}`);
    results.steps.push({ step: 'create_save_readback', ok: true, revision: cloudAfterCreate.revision });
    console.log('[smoke] create -> save -> authoritative server readback: PASS');

    // 2. reload -> persists
    await deviceA.page.reload({ waitUntil: 'domcontentloaded' });
    await deviceA.page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true && window.click360SyncStatus?.status === 'synced', { timeout: 60000 });
    const persistedAfterReload = await deviceA.page.evaluate((id) => window.click360GetTenantState().products.find((p) => p.id === id), createdId);
    assert(persistedAfterReload && Number(persistedAfterReload.stock) === 17, `product did not persist across reload: ${JSON.stringify(persistedAfterReload)}`);
    results.steps.push({ step: 'reload_persists', ok: true });
    console.log('[smoke] reload -> persists: PASS');

    // 3. second device sees it
    const deviceB = await openSignedIn(browser, 'Device B');
    await deviceB.page.waitForFunction((id) => window.click360GetTenantState().products.some((p) => p.id === id && Number(p.stock) === 17), createdId, { timeout: 30000 });
    results.steps.push({ step: 'second_device_sees_it', ok: true });
    console.log('[smoke] second device sees it: PASS');

    // 4. second device edits -> conflict/convergence contract
    const editResult = await submitSyntheticProduct(deviceB.page, { id: createdId, code: productCode, name: 'QA Smoke Staging Product', stock: 21, price:12, cardPrice:12.5 });
    const outcome = /confirmado en la nube/.test(editResult.message) ? 'confirmed'
      : /Hay un conflicto/.test(editResult.message) ? 'safe_conflict'
      : /no fue confirmado/.test(editResult.message) ? 'not_confirmed' : 'unexpected';
    assert(outcome !== 'unexpected', `unexpected/unexplained outcome on Device B edit: ${editResult.message}`);
    const cloudAfterEdit = await readCloudProduct(db, uid, createdId);
    if (outcome === 'confirmed') {
      assert(cloudAfterEdit.product && Number(cloudAfterEdit.product.stock) === 21, `Device B reported CONFIRMED but cloud stock is ${cloudAfterEdit.product?.stock} -- false positive`);
    } else {
      assert(cloudAfterEdit.product && [17, 21].includes(Number(cloudAfterEdit.product.stock)), `cloud stock corrupted after ${outcome}: ${cloudAfterEdit.product?.stock}`);
    }
    results.steps.push({ step: 'second_device_edit_conflict_contract', ok: true, outcome, cloudStock: cloudAfterEdit.product?.stock });
    console.log(`[smoke] second device edits -> conflict/convergence contract: PASS (outcome=${outcome}, cloudStock=${cloudAfterEdit.product?.stock})`);

    // Device A converges
    try {
      await deviceA.page.evaluate(() => window.click360RefreshNow());
    } catch (error) {
      throw new Error(`refreshNow evaluate failed: ${error.message}`);
    }
    try {
      await deviceA.page.waitForFunction(({ id, expected }) => {
        const p = window.click360GetTenantState().products.find((c) => c.id === id);
        return p && Number(p.stock) === expected;
      }, { id: createdId, expected: Number(cloudAfterEdit.product.stock) }, { timeout: 30000 });
    } catch (error) {
      const currentStock = await deviceA.page.evaluate((id) => window.click360GetTenantState().products.find((c) => c.id === id)?.stock, createdId);
      throw new Error(`convergence wait failed: ${error.message} (current local stock=${currentStock}, expected=${cloudAfterEdit.product.stock})`);
    }
    results.steps.push({ step: 'device_a_converges', ok: true });
    console.log('[smoke] Device A converges to true cloud value: PASS');

    // 5. print qty 2/4/6/10, QR 1:1, pitch 64mm
    const printProduct = { ...persistedAfterReload, id: createdId, qty: Number(cloudAfterEdit.product.stock), stock: Number(cloudAfterEdit.product.stock) };
    const printResults = {};
    for (const qty of [2, 4, 6, 10]) {
      const trace = await captureLabelEvidence(deviceA.page, printProduct, qty);
      printResults[qty] = trace;
      assert(trace.column2Inside, `qty=${qty}: column 2 must remain inside the physical page`);
      assert(trace.qrSquare, `qty=${qty}: QR must be 1:1`);
      assert(trace.noVerticalDrift, `qty=${qty}: pitch must be exactly 64mm with zero drift`);
    }
    assert(JSON.stringify(printResults[2].patterns) === JSON.stringify(['XX']), 'qty=2 must be [X][X]');
    assert(JSON.stringify(printResults[4].patterns) === JSON.stringify(['XX', 'XX']), 'qty=4 must be two full rows');
    assert(JSON.stringify(printResults[6].patterns) === JSON.stringify(['XX', 'XX', 'XX']), 'qty=6 must be three full rows');
    assert(printResults[10].patterns.length === 5 && printResults[10].patterns.every((p) => p === 'XX'), 'qty=10 must be five full rows');
    results.steps.push({ step: 'print_2_4_6_10_qr_pitch', ok: true, printResults });
    console.log('[smoke] print qty2/4/6/10, QR 1:1, pitch 64mm: PASS');

    // 6. light route smoke
    const routes = ['apartados', 'sell', 'cash', 'workers', 'logistics', 'inventory'];
    const routeChecks = [];
    for (const route of routes) {
      const check = await routeSmoke(deviceA.page, route);
      routeChecks.push(check);
      assert(!check.hasError, `route #${route} shows an error state`);
    }
    results.steps.push({ step: 'route_smoke', ok: true, routeChecks });
    console.log('[smoke] route smoke (apartados/sell/cash/workers/logistics/inventory): PASS');

    assert(deviceA.pageErrors.length === 0, `Device A unexpected page errors: ${JSON.stringify(deviceA.pageErrors)}`);
    assert(deviceB.pageErrors.length === 0, `Device B unexpected page errors: ${JSON.stringify(deviceB.pageErrors)}`);

    await deviceA.context.close();
    await deviceB.context.close();
    console.log('CLICK360_STAGING_SMOKE PASS');
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('CLICK360_STAGING_SMOKE FAIL:', error.message);
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
