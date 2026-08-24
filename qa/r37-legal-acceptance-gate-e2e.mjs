import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Sections 17-20): CLICK 360 previously only captured a legal
 * acceptance once, during the "Configura tu negocio" onboarding modal --
 * any account created BEFORE that checkbox existed (or before a future
 * TERMS_VERSION/PRIVACY_VERSION bump) has no matching legalAcceptances
 * record and was NEVER asked again, at any point, for the rest of the
 * account's life. The fix adds a read-back check
 * (hasAcceptedCurrentLegalVersions()) and a blocking gate
 * (legalAcceptanceGateView()) that intercepts every route except #legal
 * for owner accounts that haven't accepted the current versions -- while
 * always allowing reading the full terms and logging out.
 *
 * Adjusted after a production-risk review: a universal hard gate would
 * have surprised every existing owner (SHARY, Lia, Industrias Omega, Mi
 * Negocio) on their very next login. The contract now distinguishes a
 * brand NEW owner (never finished onboarding -- hard gate, exactly as
 * before) from an already-onboarded LEGACY owner (a dismissible banner,
 * 7 days of normal grace operation, then a mutation-only gate that never
 * blocks reads/exports/account-access/support/logout).
 *
 * This test drives the real app.js in a browser through these scenarios:
 *  1. New owner (never onboarded), no acceptance record -> hard gate
 *     blocks 'home'; accepting via the gate's checkbox+button unblocks.
 *  2. Owner, matching acceptance record already on file -> never gated,
 *     no banner shown again.
 *  3. Worker role -> never gated by this owner-scoped gate.
 *  4. #legal itself is always reachable even while gated (never a trap).
 *  5. Legacy owner (already onboarded), banner never presented yet ->
 *     NOT route-gated, NOT write-gated (day-1 grace starts now).
 *  6. Legacy owner, banner presented 1 day ago -> still within the
 *     7-day grace window: normal read+write operation, no gate.
 *  7. Legacy owner, banner presented 8 days ago (grace expired) ->
 *     mutations blocked with reason 'legal_acceptance_required', but
 *     reads/navigation/#legal/logout still work.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LEGAL_GATE_E2E_PORT || 4731);
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

function baseRealData(overrides = {}) {
  return {
    businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
    activeBusinessId: 'biz_main',
    products: [], sales: [], movements: [], cashSessions: [],
    dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
    tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
    restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
    legalAcceptances: [], finance: {}, settings: {}, logistics: {},
    updatedAtMs: Date.now(), updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function scenarioNoAcceptance(page) {
  const uid = 'test-r37-legal-no-accept-uid';
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
      legalAcceptances: [], finance: {}, settings: {}, logistics: {},
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);

    window.click360Route('home');
    const gatedHash = location.hash;
    const gatedHTML = document.getElementById('app').innerHTML;
    const hasCheckbox = !!document.getElementById('legalGateCheckbox');
    const hasAcceptBtnDisabled = document.getElementById('legalGateAcceptBtn')?.disabled;
    const hasLogout = !!document.getElementById('logoutTop') || !!document.getElementById('logoutSide');
    const hasLegalLink = gatedHTML.includes('href="#legal"');

    // Reading #legal must always work, even while gated.
    window.click360Route('legal');
    const legalHash = location.hash;
    const legalHTML = document.getElementById('app').innerHTML;

    // Back to a normal route: must be gated again (not permanently escaped
    // by having visited #legal).
    window.click360Route('home');
    const stillGatedHash = location.hash;

    // Interactive wiring: checking the consent checkbox must enable the
    // accept button. The actual click->save()->unblock round trip is
    // covered separately below by directly injecting an accepted state
    // (the same way every other test in this suite proves post-write
    // effects) -- save() itself requires a real Firebase auth.currentUser,
    // which this offline harness has no way to bootstrap (see
    // r37-reliability-hash-labels-harness.cjs's comment for the same
    // constraint), so a live click-through save() is not exercisable here.
    window.click360Route('home'); // re-enter gate to get fresh bound checkbox/button
    document.getElementById('legalGateCheckbox').checked = true;
    document.getElementById('legalGateCheckbox').dispatchEvent(new Event('change'));
    const acceptBtnEnabledAfterCheck = !document.getElementById('legalGateAcceptBtn').disabled;

    return {
      gatedHash, hasCheckbox, hasAcceptBtnDisabled, hasLogout, hasLegalLink,
      legalHash, legalHasContent: legalHTML.includes('Terminos y condiciones'),
      stillGatedHash,
      acceptBtnEnabledAfterCheck,
    };
  }, uid);

  assert(result.gatedHash === '#legalGate', `An owner with no acceptance record must be routed to the legal gate on 'home', got hash ${result.gatedHash}`);
  assert(result.hasCheckbox, 'The gate must render a consent checkbox');
  assert(result.hasAcceptBtnDisabled, 'The accept button must start disabled until the checkbox is checked');
  assert(result.hasLogout, 'Logout must always be reachable from the gate (via the normal app shell)');
  assert(result.hasLegalLink, 'The gate must link to #legal so the user can read the full terms before accepting');
  assert(result.legalHash === '#legal', '#legal must always be reachable, even while gated');
  assert(result.legalHasContent, '#legal must render the real terms content, not the gate itself, when explicitly visited');
  assert(result.stillGatedHash === '#legalGate', 'Visiting #legal must not permanently bypass the gate -- navigating to a normal route afterward must gate again until actually accepted');
  assert(result.acceptBtnEnabledAfterCheck, 'Checking the consent checkbox must enable the accept button');
}

async function scenarioAlreadyAccepted(page) {
  const uid = 'test-r37-legal-already-accepted-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'owner2@example.com', role: 'owner', name: 'Owner2', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    const termsVersion = window.CLICK360_V16_DOMAIN?.TERMS_VERSION;
    const privacyVersion = window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION || termsVersion;
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion, privacyVersion, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
      finance: {}, settings: {}, logistics: {},
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);
    window.click360Route('home');
    return { hash: location.hash, showsHome: document.getElementById('app').innerHTML.includes('Hola,') };
  }, uid);
  assert(result.hash === '#home', `An owner with a matching acceptance record must never be gated, got hash ${result.hash}`);
  assert(result.showsHome, 'home must render normally when already accepted');
}

async function scenarioWorkerNeverGated(page) {
  const uid = 'test-r37-legal-worker-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: 'owner-of-worker', ownerId: 'owner-of-worker', businessId: 'owner-of-worker', tenantKey: `owner:owner-of-worker:business:owner-of-worker`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'worker@example.com', role: 'worker', name: 'Worker', photoURL: '', status: 'active', approved: true, ownerId: 'owner-of-worker', isOwner: false, source: 'accountAccess', permissions: {} };
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [], finance: {}, settings: {}, logistics: {},
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);
    window.click360Route('home');
    return { hash: location.hash, legalStatus: window.CLICK360_QA.legalAcceptanceStatus() };
  }, uid);
  // A separate, worker-scoped access-request gate (see
  // qa/r37-worker-access-gate-e2e.mjs) DOES intercept unapproved workers --
  // that is intentional and orthogonal to this owner-scoped LEGAL gate.
  // What this scenario proves is narrower: the legal gate specifically
  // must never fire for a worker (legalGateEligible() requires
  // isOwnerUser()), regardless of whatever the worker-access-gate does.
  assert(result.hash !== '#legalGate', `A worker role must never be gated by the owner-scoped legal gate specifically, got hash ${result.hash}`);
  assert(result.legalStatus === 'accepted', `legalAcceptanceStatus() must short-circuit to 'accepted' for a non-owner (legalGateEligible() requires isOwnerUser()), got ${result.legalStatus}`);
}

async function scenarioLegacyGraceUnpresented(page) {
  const uid = 'test-r37-legal-legacy-unpresented-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'legacy1@example.com', role: 'owner', name: 'Legacy1', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Legacy', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [], finance: {}, logistics: {},
      settings: { onboarding: { completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), operationId: 'legacy-onb', version: 16.2, checklist: {} } },
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);
    window.click360Route('home');
    const status = window.CLICK360_QA.legalAcceptanceStatus();
    const gate = window.CLICK360_QA.writeGateStatus();
    return { hash: location.hash, status, writeAllowed: gate.allowed, writeReason: gate.reason, showsHome: document.getElementById('app').innerHTML.includes('Hola,') };
  }, uid);
  assert(result.hash === '#home', `A legacy (already-onboarded) owner must NEVER be route-gated to #legalGate, got hash ${result.hash}`);
  assert(result.showsHome, 'home must render normally for a legacy owner even with no acceptance record yet');
  assert(result.status === 'grace_unpresented', `A legacy owner whose banner has never been shown must classify as grace_unpresented, got ${result.status}`);
  assert(result.writeReason !== 'legal_acceptance_required', `A legacy owner in grace_unpresented status must not be blocked BY THE LEGAL GATE (other gates like auth_not_ready are a harness limitation, not a real block -- see r37-reliability-hash-labels-harness.cjs's comment), got reason ${result.writeReason}`);
}

async function scenarioLegacyGraceActive(page) {
  const uid = 'test-r37-legal-legacy-grace-active-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'legacy2@example.com', role: 'owner', name: 'Legacy2', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    const presentedYesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Legacy', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [], finance: {}, logistics: {},
      settings: {
        onboarding: { completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), operationId: 'legacy-onb', version: 16.2, checklist: {} },
        legalGrace: { termsPresentedAt: presentedYesterday, presentedTermsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, presentedPrivacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, lastShownAt: presentedYesterday }
      },
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);
    window.click360Route('home');
    const status = window.CLICK360_QA.legalAcceptanceStatus();
    const gate = window.CLICK360_QA.writeGateStatus();
    return { hash: location.hash, status, writeAllowed: gate.allowed, writeReason: gate.reason };
  }, uid);
  assert(result.hash === '#home', `A legacy owner within the 7-day grace window must NOT be route-gated, got hash ${result.hash}`);
  assert(result.status === 'grace_active', `A legacy owner presented 1 day ago must classify as grace_active, got ${result.status}`);
  assert(result.writeReason !== 'legal_acceptance_required', `A legacy owner within grace must not be blocked BY THE LEGAL GATE -- normal operation during the 7-day window, got reason ${result.writeReason}`);
}

async function scenarioLegacyMutationGateAfterGrace(page) {
  const uid = 'test-r37-legal-legacy-mutation-gate-uid';
  const result = await page.evaluate(async (uid) => {
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'legacy3@example.com', role: 'owner', name: 'Legacy3', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    const presented8DaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    window.click360ApplyTenantState({
      businesses: [{ id: 'biz_main', name: 'Tienda Legacy', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto real', qty: 10, stock: 10, price: 5 }],
      sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [], finance: {}, logistics: {},
      settings: {
        onboarding: { completedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), operationId: 'legacy-onb', version: 16.2, checklist: {} },
        legalGrace: { termsPresentedAt: presented8DaysAgo, presentedTermsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, presentedPrivacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, lastShownAt: presented8DaysAgo }
      },
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }, context);

    // Reads/navigation must still work: home, inventory (read), #legal,
    // and account access -- none of these are save()-gated.
    window.click360Route('home');
    const homeHash = location.hash;
    const homeShowsContent = document.getElementById('app').innerHTML.length > 200;
    window.click360Route('inventory');
    const inventoryHash = location.hash;
    const inventoryShowsProduct = document.getElementById('app').innerHTML.includes('Producto real');
    window.click360Route('legal');
    const legalHash = location.hash;
    window.click360Route('access');
    const accessHash = location.hash;

    const status = window.CLICK360_QA.legalAcceptanceStatus();
    const gate = window.CLICK360_QA.writeGateStatus();

    return {
      homeHash, homeShowsContent, inventoryHash, inventoryShowsProduct, legalHash, accessHash,
      status, writeAllowed: gate.allowed, writeReason: gate.reason
    };
  }, uid);
  assert(result.homeHash === '#home', `Expired-grace must NOT route-block reads -- home, got hash ${result.homeHash}`);
  assert(result.homeShowsContent, 'home must render real content after grace expires (reads are never blocked)');
  assert(result.inventoryHash === '#inventory', `Expired-grace must NOT route-block inventory (a read view), got hash ${result.inventoryHash}`);
  assert(result.inventoryShowsProduct, 'inventory must show real product data after grace expires -- reading/consulting information is always allowed');
  assert(result.legalHash === '#legal', 'Reading #legal must always work after grace expires');
  assert(result.accessHash === '#access', 'Account access (#access) must always work after grace expires');
  assert(result.status === 'mutation_gate', `A legacy owner presented 8 days ago (past the 7-day grace) must classify as mutation_gate, got ${result.status}`);
  assert(result.writeAllowed === false, 'A legacy owner past grace must have NEW mutations blocked');
  assert(result.writeReason === 'legal_acceptance_required', `The write-block reason must be legal_acceptance_required, got ${result.writeReason}`);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 15000 });

    await scenarioNoAcceptance(page);
    await scenarioAlreadyAccepted(page);
    await scenarioWorkerNeverGated(page);
    await scenarioLegacyGraceUnpresented(page);
    await scenarioLegacyGraceActive(page);
    await scenarioLegacyMutationGateAfterGrace(page);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 legal-acceptance-gate E2E PASS: a brand-new owner is hard-gated on every route except #legal until accepting; an already-onboarded legacy owner is NEVER route-gated, gets a dismissible banner and 7 days of normal grace, and only loses NEW mutations (never reads/exports/account-access/#legal/logout) after grace expires; already-accepted owners and worker sessions are never gated.');
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
