import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer } from 'firebase/firestore';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'playwright', 'r38-commercial-core');
const port = Number(process.env.CLICK360_R38_CORE_HTTP_PORT || 4798);
const firestorePort = Number(process.env.CLICK360_R38_CORE_FIRESTORE_PORT || 48098);
const authPort = Number(process.env.CLICK360_R38_CORE_AUTH_PORT || 49108);
const projectId = process.env.CLICK360_R38_CORE_PROJECT || 'demo-click360-r38-core';
if(!/^demo-click360-r38-(core|restaurant)$/.test(projectId))throw new Error('Dedicated emulator project required');
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
    const snapshot = await getDocFromServer(doc(db, 'businesses', uid, 'state', 'main'));
    assert(snapshot.metadata.fromCache === false, 'authoritative read must never use cache');
    value = snapshot.data();
  });
  return value;
}

async function newAppContext(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
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

async function openSignedIn(browser, viewport) {
  const context = await newAppContext(browser, viewport);
  const page = await context.newPage();
  // Belt-and-suspenders on top of each call's own explicit timeout: this
  // page-level default overrides Playwright's built-in 30s default for
  // every wait on this page, so a slow CI runner (many prior sub-tests
  // already run in this same job, real browser + real Firestore emulator
  // round trips) has real headroom before any of this session's own waits
  // can time out.
  page.setDefaultTimeout(60000);
  const pageErrors = [];
  await context.addInitScript(()=>{
    window.R38_SYNC_TRACE=[];
    window.addEventListener('click360-sync-status',event=>{
      const state=window.click360GetTenantState?.();
      window.R38_SYNC_TRACE.push({at:Date.now(),...event.detail,products:state?.products?.length,hydrated:window.click360IsTenantDataHydrated?.(),provenance:window.click360GetTenantStateProvenance?.()});
      if(window.R38_SYNC_TRACE.length>100)window.R38_SYNC_TRACE.shift();
    });
  });
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
async function submitProduct(page, values, { allowOneConflictRetry = true, beforeUnconfirmedRetry = null } = {}) {
  let result = await submitProductOnce(page, values);
  if (allowOneConflictRetry && /Hay un conflicto de sincronizaci.n pendiente/.test(result.message)) {
    result = await submitProductOnce(page, values);
  }
  if (/El cambio no fue confirmado/.test(result.message) && typeof beforeUnconfirmedRetry === 'function') {
    const retrySafe = await beforeUnconfirmedRetry(result);
    assert(retrySafe === true, `Unconfirmed retry was not safe: ${JSON.stringify(result)}`);
    result = await submitProductOnce(page, values);
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
    window.__r38PreviousProductDiagnostic = window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS;
    form.requestSubmit();
  }, values);
  await page.waitForFunction(() => {
    const toast = document.getElementById('toast');
    const message = toast?.textContent || '';
    const diagnostic = window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS;
    if (!diagnostic || diagnostic === window.__r38PreviousProductDiagnostic || diagnostic.outcome === 'pending') return false;
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
    confirmation: window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS || null,
    runtimeError: window.CLICK360_LAST_RUNTIME_ERROR || null
  }));
}


function assertProduct(documentValue, id, expectedStock, label) {
  const product = documentValue?.payload?.data?.products?.find((candidate) => candidate.id === id);
  assert(product, `[${label}] product ${id} is missing from cloud`);
  assert(Number(product.qty) === expectedStock, `[${label}] cloud qty must be ${expectedStock}, got ${product.qty}`);
  assert(Number(product.stock) === expectedStock, `[${label}] cloud stock must be ${expectedStock}, got ${product.stock}`);
  assert(Number(product.qty) === Number(product.stock), `[${label}] qty and stock must remain identical`);
  return product;
}


function writeEmulatorConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'click360-r37-2-4-'));
  writeFileSync(path.join(dir, 'firestore.rules'), rules);
  writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      auth: { host: '127.0.0.1', port: authPort },
      firestore: { host: '127.0.0.1', port: firestorePort, websocketPort: authPort+10 },
      hub: { host: '127.0.0.1', port: authPort+20 },
      logging: { host: '127.0.0.1', port: authPort+30 },
      ui: { enabled: false }
    }
  }, null, 2));
  return path.join(dir, 'firebase.json');
}


export {root,outputDir,port,firestorePort,authPort,projectId,javaDirs,url,rules,identity,assert,stopProcessTree,waitForUrl,createEmulatorUser,seed,readCloud,openSignedIn,submitProduct,assertProduct,largeTenantData,stateDocument,accountAccess,writeEmulatorConfig};
