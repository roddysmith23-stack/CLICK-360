import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'playwright', 'r37-2-4-real-customer-journey');
const port = Number(process.env.CLICK360_R3724_HTTP_PORT || 4786);
const firestorePort = Number(process.env.CLICK360_R3724_FIRESTORE_PORT || 48086);
const authPort = Number(process.env.CLICK360_R3724_AUTH_PORT || 49096);
const projectId = 'demo-click360-r37-2-4';
const apiKey = 'fake-api-key';
const url = `http://127.0.0.1:${port}/index.html`;
const rules = readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const password = 'click360-local-emulator-only';
const email = `owner-r37-2-4-${Date.now().toString(36)}@example.test`;
const javaDirs = [
  '/opt/homebrew/opt/openjdk@21/bin', '/usr/local/opt/openjdk@21/bin',
  '/opt/homebrew/opt/openjdk/bin', '/usr/local/opt/openjdk/bin'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

async function waitForUrl(target, label) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try { if ((await fetch(target)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not start at ${target}`);
}

function identity(uid) {
  return { schemaVersion: 10, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}` };
}

function labelTemplate(uid) {
  const paper = {
    id: 'roll-2-customer', mediaType: 'roll-2', widthMm: 40, heightMm: 60,
    mediaWidthMm: 40, mediaHeightMm: 0, columns: 2, rows: 1,
    gapXmm: 4, gapYmm: 4, marginTopMm: 13, marginRightMm: 2,
    marginBottomMm: 2, marginLeftMm: 6, pitchMm: 0, xOffsetMm: 0,
    yOffsetMm: 0, scaleX: 1, scaleY: 1, dpi: 203, orientation: 'portrait',
    contentRotation: 0
  };
  return {
    id: 'tpl-ahora-si', businessId: uid, name: 'AHORA SI QA', isDefault: true,
    renderer: 'universal-mm-v2', widthMm: 40, heightMm: 60, mediaWidthMm: 40,
    mediaHeightMm: 0, columns: 2, rows: 1, gapXmm: 4, gapYmm: 4,
    marginTopMm: 13, marginRightMm: 2, marginBottomMm: 2, marginLeftMm: 6,
    dpi: 203, contentRotation: 0, priceFormat: 'short',
    universalDocument: {
      paper,
      objects: [
        { id: 'qr', type: 'qr', xMm: 2, yMm: 2, widthMm: 18, heightMm: 18, visible: true, locked: false, rotation: 0, z: 1 },
        { id: 'name', type: 'name', xMm: 22, yMm: 7, widthMm: 34, heightMm: 5, visible: true, locked: false, rotation: 0, z: 2 },
        { id: 'price', type: 'price', xMm: 22, yMm: 54, widthMm: 34, heightMm: 5, visible: true, locked: false, rotation: 0, z: 3 }
      ],
      quantity: 1,
      startSlot: 1
    }
  };
}

function largeTenantData(uid) {
  const now = Date.now();
  const products = Array.from({ length: 436 }, (_, index) => ({
    id: `fixture-product-${index + 1}`,
    businessId: uid,
    code: `FIX-${String(index + 1).padStart(4, '0')}`,
    name: `Producto sintético ${index + 1}`,
    category: index % 2 ? 'Categoría A' : 'Categoría B',
    qty: 5 + (index % 20),
    stock: 5 + (index % 20),
    cost: 2.5,
    price: 8.75,
    cardPrice: 9,
    notes: `fixture-${index}-${'x'.repeat(850)}`,
    createdAtMs: now - 100000 - index,
    updatedAtMs: now - 100000 - index
  }));
  return {
    businesses: [{ id: uid, name: 'Negocio QA grande', status: 'activo', type: 'ropa', settings: {} }],
    activeBusinessId: uid,
    products,
    sales: Array.from({ length: 24 }, (_, index) => ({ id: `sale-${index}`, businessId: uid, total: 10 + index, items: [], createdAtMs: now - index })),
    movements: Array.from({ length: 69 }, (_, index) => ({ id: `movement-${index}`, businessId: uid, kind: 'ajuste', amount: 0, createdAtMs: now - index })),
    dailyReports: [], invoices: [], deletedProducts: [],
    auditLogs: Array.from({ length: 180 }, (_, index) => ({ id: `audit-${index}`, businessId: uid, action: 'fixture', at: new Date(now - index).toISOString() })),
    layaways: [], cashSessions: [], tables: [], tableOrders: [],
    restaurantPayments: [], restaurantPrintHistory: [], restaurantEvents: [], restaurantRecipes: [],
    labelPrintHistory: [],
    notifications: Array.from({ length: 377 }, (_, index) => ({ id: `notice-${index}`, businessId: uid, type: 'fixture', createdAtMs: now - index })),
    legalAcceptances: [{ id: 'legal-qa', businessId: uid, uid, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
    finance: { payments: [], loans: [], envelopes: [], goals: [] },
    logistics: {},
    settings: {
      workers: [], labelTemplates: [labelTemplate(uid)], labelProfiles: [], customers: [], reminders: [],
      onboarding: { completedAt: new Date().toISOString(), operationId: 'qa-onboarding', version: 16.2, checklist: {} }
    },
    updatedAtMs: now,
    updatedAt: new Date(now).toISOString()
  };
}

function stateDocument(uid, revision, data) {
  const tenantIdentity = identity(uid);
  return {
    ...tenantIdentity,
    revision,
    updatedAtMs: revision,
    updatedAt: new Date().toISOString(),
    payload: { schemaVersion: 10, identity: tenantIdentity, data }
  };
}

function accountAccess(uid) {
  return {
    uid, ownerId: uid, businessId: uid, tenantKey: identity(uid).tenantKey,
    email, name: 'Owner QA', status: 'founder_legacy', plan: 'founder_legacy',
    planCode: 'founder_legacy', billingStatus: 'lifetime', source: 'qa_fixture',
    entitlementVersion: 16, revision: 1
  };
}

async function createEmulatorUser() {
  const response = await fetch(
    `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const body = await response.json();
  if (!response.ok || !body.localId) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return body.localId;
}

async function seed(testEnv, writer) {
  return testEnv.withSecurityRulesDisabled(async (context) => writer(context.firestore()));
}

async function readCloud(testEnv, uid) {
  let value = null;
  await seed(testEnv, async (db) => {
    const snapshot = await getDoc(doc(db, 'businesses', uid, 'state', 'main'));
    value = snapshot.data();
  });
  return value;
}

async function newAppContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ projectId: targetProject, apiKey: key, firestorePortNumber, authPortNumber }) => {
    let namespace;
    Object.defineProperty(window, 'firebase', {
      configurable: true,
      get() { return namespace; },
      set(value) {
        namespace = value;
        if (!value || value.__click360EmulatorPatched) return;
        value.__click360EmulatorPatched = true;
        const originalInitializeApp = value.initializeApp.bind(value);
        value.initializeApp = (_config, name) => {
          const app = originalInitializeApp({ apiKey: key, projectId: targetProject, appId: '1:1:web:r3724', authDomain: `${targetProject}.firebaseapp.com`, messagingSenderId: '1' }, name);
          app.auth().useEmulator(`http://127.0.0.1:${authPortNumber}`, { disableWarnings: true });
          app.firestore().useEmulator('127.0.0.1', firestorePortNumber);
          return app;
        };
      }
    });
  }, { projectId, apiKey, firestorePortNumber: firestorePort, authPortNumber: authPort });
  return context;
}

async function openSignedIn(browser) {
  const context = await newAppContext(browser);
  const page = await context.newPage();
  // Belt-and-suspenders on top of each call's own explicit timeout: this
  // page-level default overrides Playwright's built-in 30s default for
  // every wait on this page, so a slow CI runner (many prior sub-tests
  // already run in this same job, real browser + real Firestore emulator
  // round trips) has real headroom before any of this session's own waits
  // can time out.
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.route('**/*', (route) => {
    const requestUrl = route.request().url();
    const local = requestUrl.startsWith(`http://127.0.0.1:${port}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${firestorePort}/`)
      || requestUrl.startsWith(`http://127.0.0.1:${authPort}/`);
    return local ? route.continue() : route.abort();
  });
  const step = async (label, fn) => {
    try { return await fn(); } catch (error) { throw new Error(`openSignedIn step "${label}" failed: ${error.message}`); }
  };
  await step('goto', () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }));
  await step('auth-fn-available', () => page.waitForFunction(() => typeof window.click360Auth?.signInWithEmailAndPassword === 'function', { timeout: 60000 }));
  await step('sign-in', () => page.evaluate(({ testEmail, testPassword }) => window.click360Auth.signInWithEmailAndPassword(testEmail, testPassword), { testEmail: email, testPassword: password }));
  await step('hydrated-and-synced', () => page.waitForFunction(() => window.click360IsTenantDataHydrated?.() === true && window.click360SyncStatus?.status === 'synced', { timeout: 60000 }));
  await step('route-inventory', () => page.evaluate(() => window.click360Route('inventory')));
  await step('new-product-visible', () => page.waitForSelector('#newProduct', { timeout: 45000 }));
  return { context, page, pageErrors };
}

// A same-tenant device left open elsewhere (this harness's own `reopenedA`)
// can, rarely, cause a genuine revision conflict for a concurrent editor --
// the r37.2.5 conflict-safety contract handles that correctly (explicit,
// recoverable, never a silent overwrite), so this helper tolerates exactly
// ONE real conflict and retries once, exactly as a real user would after
// reading "Hay un conflicto..." and clicking save again. A second
// consecutive conflict, or any other unexplained outcome, still fails hard.
async function submitProduct(page, values, { allowOneConflictRetry = true } = {}) {
  const result = await submitProductOnce(page, values);
  if (allowOneConflictRetry && /Hay un conflicto de sincronizaci.n pendiente/.test(result.message)) {
    return submitProductOnce(page, values);
  }
  assert(/Producto (creado|actualizado) y confirmado en la nube/.test(result.message), `Product submit failed: ${JSON.stringify(result)}`);
  return result;
}

async function submitProductOnce(page, values) {
  await page.evaluate((product) => {
    const trigger = product.id
      ? document.querySelector(`[data-edit="${CSS.escape(product.id)}"]`)
      : document.getElementById('newProduct');
    if (!(trigger instanceof HTMLElement)) throw new Error(`Missing product trigger ${product.id || 'new'}`);
    trigger.click();
    const valuesById = {
      pCode: product.code,
      pName: product.name,
      pQty: String(product.stock),
      pCost: '4.00',
      pPrice: '12.00',
      pCardPrice: '12.50'
    };
    Object.entries(valuesById).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (!input) throw new Error(`Missing product field ${id}`);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = document.getElementById('productForm');
    if (!(form instanceof HTMLFormElement)) throw new Error('Missing product form');
    form.requestSubmit();
  }, values);
  await page.waitForFunction(() => {
    const toast = document.getElementById('toast');
    const message = toast?.textContent || '';
    // "Tuvimos un inconveniente..." is runtime-guard's unrelated generic
    // crash-guard toast (fired by this harness's own network blocking of
    // non-local resources like apis.google.com) -- it can stay visible
    // across the confirmation retry window and must never be mistaken for
    // this product save's own outcome.
    return /Producto (creado|actualizado) y confirmado en la nube/.test(message)
      || (toast?.classList.contains('err') && !/Sincronizando cambios/.test(message) && !/Tuvimos un inconveniente/.test(message));
  }, { timeout: 30000 });
  return page.evaluate(() => ({
    message: document.getElementById('toast')?.textContent || '',
    className: document.getElementById('toast')?.className || '',
    syncStatus: window.click360SyncStatus?.status || '',
    syncError: window.click360SyncStatus?.error || null,
    gate: window.click360WriteGate?.() || null,
    runtimeError: window.CLICK360_LAST_RUNTIME_ERROR || null
  }));
}

async function captureAppEvidence(page, fileName) {
  await page.screenshot({
    path: path.join(outputDir, fileName),
    animations: 'disabled',
    fullPage: false,
    timeout: 60000
  });
}

async function captureProductEvidence(page, fileName, productId) {
  await page.evaluate((targetProductId) => {
    const search = document.getElementById('productSearch');
    if (!(search instanceof HTMLInputElement)) throw new Error('Missing product search');
    search.value = 'TEST-PERSIST-001';
    search.oninput?.(new Event('input', { bubbles: true }));
    const productCard = document.querySelector(`[data-pid="${CSS.escape(targetProductId)}"]`);
    if (!(productCard instanceof HTMLElement)) throw new Error(`Missing product card ${targetProductId}`);
    document.getElementById('qa-product-evidence')?.remove();
    const evidence = document.createElement('section');
    evidence.id = 'qa-product-evidence';
    evidence.style.cssText = 'position:fixed;z-index:2147483647;inset:0;background:#101010;color:#fff;padding:32px;display:grid;align-content:start;gap:18px;isolation:isolate;';
    const isolateStyle = document.createElement('style');
    isolateStyle.textContent = 'body > :not(#qa-product-evidence) { visibility:hidden!important; }';
    const title = document.createElement('h1');
    title.textContent = 'CLICK 360 · Persistencia de inventario';
    title.style.cssText = 'font:700 24px/1.2 system-ui;margin:0;color:#f4c430;';
    const cardClone = productCard.cloneNode(true);
    cardClone.classList.remove('stagger');
    cardClone.style.cssText += ';opacity:1!important;visibility:visible!important;transform:none!important;animation:none!important;width:100%;';
    cardClone.querySelectorAll('*').forEach((node) => {
      node.style.animation = 'none';
      node.style.opacity = '1';
      node.style.visibility = 'visible';
    });
    evidence.append(isolateStyle, title, cardClone);
    document.body.append(evidence);
  }, productId);
  await page.waitForTimeout(150);
  await page.locator('#qa-product-evidence').screenshot({
    path: path.join(outputDir, fileName),
    animations: 'disabled',
    timeout: 60000
  });
  await page.evaluate(() => document.getElementById('qa-product-evidence')?.remove());
}

function assertProduct(documentValue, id, expectedStock, label) {
  const product = documentValue?.payload?.data?.products?.find((candidate) => candidate.id === id);
  assert(product, `[${label}] product ${id} is missing from cloud`);
  assert(Number(product.qty) === expectedStock, `[${label}] cloud qty must be ${expectedStock}, got ${product.qty}`);
  assert(Number(product.stock) === expectedStock, `[${label}] cloud stock must be ${expectedStock}, got ${product.stock}`);
  assert(Number(product.qty) === Number(product.stock), `[${label}] qty and stock must remain identical`);
  return product;
}

async function captureLabelEvidence(page, product, quantity, fileName) {
  const result = await page.evaluate(async ({ targetProduct, copies }) => {
    const source = window.click360GetTenantState().settings.labelTemplates.find((template) => template.id === 'tpl-ahora-si').universalDocument;
    const documentModel = { ...source, quantity: copies, startSlot: 1, priceFormat: 'short' };
    const job = await window.click360UniversalLabelTest.render(targetProduct, documentModel);
    document.querySelector('#qa-label-evidence')?.remove();
    const evidence = document.createElement('section');
    evidence.id = 'qa-label-evidence';
    evidence.style.cssText = 'position:absolute;z-index:999999;left:0;top:0;background:#fff;color:#000;padding:16px;display:grid;gap:12px;';
    evidence.append(job.node);
    document.body.append(evidence);
    const trace = job.plan.pages.flatMap((pagePlan, pageIndex) => pagePlan.cells
      .filter((cell) => cell.status === 'filled')
      .map((cell) => ({
        copyIndex: cell.item.copy,
        pageIndex,
        rowIndex: cell.row - 1,
        columnIndex: cell.column - 1,
        slotIndex: cell.slot - 1,
        xMm: cell.xMm,
        yMm: cell.yMm,
        rightMm: cell.xMm + job.document.paper.widthMm
      })));
    const objectsInside = job.document.objects.filter((object) => object.visible !== false).every((object) =>
      object.xMm >= 0 && object.yMm >= 0
      && object.xMm + object.widthMm <= job.document.paper.widthMm
      && object.yMm + object.heightMm <= job.document.paper.heightMm);
    const qr = job.document.objects.find((object) => object.type === 'qr');
    return {
      quantity: copies,
      occupiedSlots: trace.length,
      columns: job.plan.columns,
      pages: job.plan.pages.length,
      media: job.media,
      trace,
      patterns: job.plan.pages.map((pagePlan) => pagePlan.cells.map((cell) => cell.status === 'filled' ? 'X' : ' ').join('')),
      column2Inside: trace.filter((entry) => entry.columnIndex === 1).every((entry) => entry.rightMm <= job.media.widthMm + 0.001),
      objectsInside,
      qrSquare: Boolean(qr && Math.abs(qr.widthMm - qr.heightMm) < 0.001),
      noVerticalDrift: job.media.heightMm === 64 && trace.every((entry) => entry.yMm === 0)
    };
  }, { targetProduct: product, copies: quantity });
  await page.locator('#qa-label-evidence').screenshot({ path: path.join(outputDir, fileName) });
  assert(result.quantity === result.occupiedSlots, `[labels ${quantity}] quantity must equal occupied slots`);
  assert(result.columns === 2, `[labels ${quantity}] plan must keep two columns`);
  assert(result.media.widthMm === 92, `[labels ${quantity}] physical page must be 92mm, got ${result.media.widthMm}`);
  assert(result.column2Inside, `[labels ${quantity}] column 2 must remain inside the physical page`);
  assert(result.objectsInside, `[labels ${quantity}] every object must remain inside label bounds`);
  assert(result.qrSquare, `[labels ${quantity}] QR must remain 1:1`);
  assert(result.noVerticalDrift, `[labels ${quantity}] physical row pitch must remain exactly 64mm without drift`);
  return result;
}

function writeEmulatorConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'click360-r37-2-4-'));
  writeFileSync(path.join(dir, 'firestore.rules'), rules);
  writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      auth: { host: '127.0.0.1', port: authPort },
      firestore: { host: '127.0.0.1', port: firestorePort },
      ui: { enabled: false }
    }
  }, null, 2));
  return path.join(dir, 'firebase.json');
}

async function run() {
  mkdirSync(outputDir, { recursive: true });
  const emulators = spawn(path.join(root, 'node_modules/.bin/firebase'), [
    'emulators:start', '--only', 'firestore,auth', '--project', projectId, '--config', writeEmulatorConfig()
  ], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, PATH: `${javaDirs.join(':')}:${process.env.PATH}` } });
  const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, detached: true, stdio: 'ignore' });
  let testEnv;
  let chromiumBrowser;
  let webkitBrowser;
  try {
    await waitForUrl(`http://127.0.0.1:${firestorePort}/`, 'Firestore emulator');
    await waitForUrl(`http://127.0.0.1:${authPort}/`, 'Auth emulator');
    await waitForUrl(url, 'CLICK 360 server');
    testEnv = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: firestorePort, rules } });
    const uid = await createEmulatorUser();
    const initialRevision = 1_800_000_000_000;
    const initialData = largeTenantData(uid);
    const serializedBytes = Buffer.byteLength(JSON.stringify(stateDocument(uid, initialRevision, initialData)));
    assert(serializedBytes >= 500_000 && serializedBytes < 950_000, `fixture must be SHARY-sized but Firestore-safe, got ${serializedBytes} bytes`);
    await seed(testEnv, async (db) => {
      await setDoc(doc(db, 'accountAccess', uid), accountAccess(uid));
      await setDoc(doc(db, 'businesses', uid, 'state', 'main'), stateDocument(uid, initialRevision, initialData));
    });

    chromiumBrowser = await chromium.launch();
    webkitBrowser = await webkit.launch();

    const deviceA = await openSignedIn(chromiumBrowser);
    await captureAppEvidence(deviceA.page, 'inventory-before.png');
    await submitProduct(deviceA.page, { code: 'TEST-PERSIST-001', name: 'Producto persistencia QA', stock: 17 });
    const afterSave = await readCloud(testEnv, uid);
    const created = afterSave.payload.data.products.find((product) => product.code === 'TEST-PERSIST-001');
    assert(created, 'Device A product must exist in cloud after the success message');
    assertProduct(afterSave, created.id, 17, 'Device A save');
    assert(Number(afterSave.revision) > initialRevision, 'Device A save must advance cloud revision');
    await captureProductEvidence(deviceA.page, 'inventory-after-save.png', created.id);
    assert(deviceA.pageErrors.length === 0, `Device A unexpected errors: ${JSON.stringify(deviceA.pageErrors)}`);
    await deviceA.context.close();

    let reopenedA = await openSignedIn(chromiumBrowser);
    await reopenedA.page.waitForFunction((id) => window.click360GetTenantState().products.some((product) => product.id === id && product.qty === 17 && product.stock === 17), created.id);
    await captureProductEvidence(reopenedA.page, 'inventory-after-reopen.png', created.id);
    // Close this session before Device B edits -- its own background
    // safety nets (e.g. the periodic auto-save interval) are a live
    // second writer on the SAME tenant document otherwise, which is
    // exactly the near-simultaneous scenario qa/r37-2-5 exists to test
    // in isolation. This test's convergence check only needs a session
    // that reopens fresh AFTER Device B's edit and proves it observes it.
    await reopenedA.context.close();

    const deviceB = await openSignedIn(webkitBrowser);
    await deviceB.page.waitForFunction((id) => window.click360GetTenantState().products.some((product) => product.id === id && product.qty === 17 && product.stock === 17), created.id);
    await captureProductEvidence(deviceB.page, 'inventory-device2.png', created.id);
    const revisionBeforeDeviceB = Number((await readCloud(testEnv, uid)).revision);
    await submitProduct(deviceB.page, { id: created.id, code: 'TEST-PERSIST-001', name: 'Producto persistencia QA', stock: 21 });
    const afterDeviceB = await readCloud(testEnv, uid);
    assertProduct(afterDeviceB, created.id, 21, 'Device B update');
    assert(Number(afterDeviceB.revision) > revisionBeforeDeviceB, 'Device B update must advance cloud revision');

    reopenedA = await openSignedIn(chromiumBrowser);
    await reopenedA.page.evaluate(() => window.click360RefreshNow());
    await reopenedA.page.waitForFunction((id) => window.click360GetTenantState().products.some((product) => product.id === id && product.qty === 21 && product.stock === 21), created.id);
    const converged = await reopenedA.page.evaluate((id) => {
      const product = window.click360GetTenantState().products.find((candidate) => candidate.id === id);
      return { qty: product.qty, stock: product.stock, sync: window.click360SyncStatus.status };
    }, created.id);
    assert(converged.qty === 21 && converged.stock === 21 && converged.sync === 'synced', `Device A must converge to Device B stock=21, got ${JSON.stringify(converged)}`);

    const traces = {};
    for (const quantity of [1, 2, 3, 4, 6, 10]) {
      const fileName = [2, 4, 6, 10].includes(quantity) ? `labels-qty${quantity}.png` : `labels-qty${quantity}-trace.png`;
      traces[quantity] = await captureLabelEvidence(reopenedA.page, { ...created, qty: 21, stock: 21 }, quantity, fileName);
    }
    assert(JSON.stringify(traces[1].patterns) === JSON.stringify(['X ']), 'quantity=1 must be [X][ ]');
    assert(JSON.stringify(traces[2].patterns) === JSON.stringify(['XX']), 'quantity=2 must be [X][X]');
    assert(JSON.stringify(traces[3].patterns) === JSON.stringify(['XX', 'X ']), 'quantity=3 must be [X][X] [X][ ]');
    assert(JSON.stringify(traces[4].patterns) === JSON.stringify(['XX', 'XX']), 'quantity=4 must be two full rows');
    assert(JSON.stringify(traces[6].patterns) === JSON.stringify(['XX', 'XX', 'XX']), 'quantity=6 must be three full rows');
    assert(traces[10].patterns.length === 5 && traces[10].patterns.every((pattern) => pattern === 'XX'), 'quantity=10 must be five full rows');

    assert(reopenedA.pageErrors.length === 0, `Reopened Device A unexpected errors: ${JSON.stringify(reopenedA.pageErrors)}`);
    assert(deviceB.pageErrors.length === 0, `Device B unexpected errors: ${JSON.stringify(deviceB.pageErrors)}`);
    await reopenedA.context.close();
    await deviceB.context.close();

    console.log(JSON.stringify({
      status: 'PASS', serializedBytes, initialRevision, afterSaveRevision: afterSave.revision,
      afterDeviceBRevision: afterDeviceB.revision, finalStock: 21,
      labelTrace: traces, evidenceDir: outputDir
    }, null, 2));
    console.log('CLICK 360 r37.2.4 real customer inventory + print journey E2E PASS.');
  } finally {
    await chromiumBrowser?.close().catch(() => {});
    await webkitBrowser?.close().catch(() => {});
    await testEnv?.cleanup().catch(() => {});
    stopProcessTree(server);
    stopProcessTree(emulators);
  }
}

await run();
