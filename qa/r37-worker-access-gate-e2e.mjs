import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 11-16, commercial priority): after accepting a worker
 * invite (a transaction that ALREADY grants a technically-active member
 * record -- untouched here, see firestore.rules), the worker's own
 * client must withhold ALL restricted UI -- never even a flash of it
 * during hydration -- until this device knows their access request was
 * approved. Owners must never be affected by this gate at all.
 *
 * This test drives the real app.js in a browser through:
 *  1. Owner session -> never gated by the worker access gate, home
 *     renders normally regardless of any access-request state.
 *  2. Worker (non-owner) session -> fail-closed by default: since this
 *     offline harness has no real Firebase auth to check the real
 *     access-request status, the gate must default to BLOCKING (showing
 *     the profile-completion form), never silently letting a Cajero
 *     straight into the restricted UI just because the status is
 *     unknown. This is the exact "UNKNOWN != FALSE" principle applied to
 *     worker onboarding.
 *  3. The gate must still allow reading #legal even while blocking the
 *     worker's own restricted UI.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_WORKER_ACCESS_GATE_E2E_PORT || 4733);
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

function baseData(overrides = {}) {
  return {
    businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
    activeBusinessId: 'biz_main',
    products: [], sales: [], movements: [], cashSessions: [],
    dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
    tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
    restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
    legalAcceptances: [], finance: {}, logistics: {},
    settings: {},
    updatedAtMs: Date.now(), updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function scenarioOwnerNeverGated(page) {
  const uid = 'test-r37-wag-owner-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
      finance: {}, logistics: {},
      settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} } },
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);
    window.click360Route('home');
    return { hash: location.hash, gated: window.CLICK360_QA.requiresWorkerAccessGate() };
  }, uid);
  assert(result.hash === '#home', `An owner must never be routed to the worker access gate, got hash ${result.hash}`);
  assert(result.gated === false, 'requiresWorkerAccessGate() must return false for an owner');
}

async function scenarioWorkerFailClosed(page) {
  const uid = 'test-r37-wag-worker-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: 'owner-of-this-worker', ownerId: 'owner-of-this-worker', businessId: 'owner-of-this-worker', tenantKey: `owner:owner-of-this-worker:business:owner-of-this-worker`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'cajero@example.com', role: 'cashier', name: 'Cajero', photoURL: '', status: 'active', approved: true, ownerId: 'owner-of-this-worker', isOwner: false, source: 'accountAccess', permissions: { sales: { read: true, create: true } } };
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto real', qty: 10, stock: 10, price: 5 }],
      sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [], finance: {}, logistics: {}, settings: {},
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);

    window.click360Route('home');
    // The gate check is async (checks a Firestore read that will reject in
    // this offline harness); poll for the re-render it triggers once it
    // settles into its fail-closed default, rather than a fixed sleep
    // (which is prone to flaking under system load).
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (location.hash === '#workerAccessGate') return resolve();
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for the worker access gate to settle'));
        setTimeout(check, 50);
      };
      check();
    });
    const homeHash = location.hash;
    const homeHTML = document.getElementById('app').innerHTML;

    window.click360Route('legal');
    const legalHash = location.hash;

    // Attempting to sell (a restricted, real worker action) must not be
    // reachable while gated -- the route itself is blocked.
    window.click360Route('sell');
    const sellHash = location.hash;

    return {
      homeHash, legalHash, sellHash,
      hasProfileForm: homeHTML.includes('workerAccessRequestForm'),
      showsProductData: homeHTML.includes('Producto real'),
    };
  }, uid);
  assert(result.homeHash === '#workerAccessGate', `A worker with no known access-request status must fail-closed to the access gate, got hash ${result.homeHash}`);
  assert(result.hasProfileForm, 'the gate must show the profile-completion form when no request exists yet (fail-closed default in this harness, matching a real first-time worker)');
  assert(!result.showsProductData, 'a gated worker must never see real product/business data -- the restricted UI must not flash before approval is confirmed');
  assert(result.legalHash === '#legal', '#legal must remain reachable even while the worker access gate is active');
  assert(result.sellHash === '#workerAccessGate', 'attempting to reach a restricted route (sell) while gated must redirect back to the access gate, not silently allow it through');
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function' && typeof window.CLICK360_QA?.requiresWorkerAccessGate === 'function', { timeout: 15000 });

    await scenarioOwnerNeverGated(page);
    await scenarioWorkerFailClosed(page);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 worker-access-gate E2E PASS: owners are never gated; a worker with unknown access-request status fails CLOSED (profile-completion form, no product data, no restricted routes reachable) instead of silently letting a Cajero into the real UI, while #legal stays reachable throughout.');
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
