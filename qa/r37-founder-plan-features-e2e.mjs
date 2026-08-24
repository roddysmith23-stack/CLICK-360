import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 30/88): "Mi plan y acceso" showed "Funciones de tu plan:
 * Incluidas -" (a bare bullet with nothing after it) for the internal
 * platform founder account (the CEO's own login), instead of a real
 * feature list.
 *
 * Root cause: normalizePlan() resolves the CEO's own account to the
 * literal status code 'founder' -- distinct from the commercial
 * 'founder_legacy' tier granted to SHARY/Lia -- and PLAN_CATALOG has no
 * entry keyed 'founder' (only 'founder_legacy'). Every catalog lookup
 * keyed directly on currentPlanCode (name, resolvedPlanFeatures, next
 * upgrade tier) silently returned nothing. The fix resolves display-only
 * lookups through displayPlanCode (currentPlanCode === 'founder' ?
 * 'founder_legacy' : currentPlanCode) while leaving isFounder/entitlements
 * untouched.
 *
 * This test drives the real app.js in a browser with the default access
 * state (window.click360AccessState left unset, which accessInfo()
 * defaults to {mode:'founder', plan:'founder', ...} -- exactly the
 * internal platform founder case) and asserts #access renders a real,
 * non-empty feature list.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_FOUNDER_PLAN_E2E_PORT || 4728);
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
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 15000 });

    const uid = 'test-r37-founder-plan-uid';
    const result = await page.evaluate((uid) => {
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'ceo@example.com', role: 'owner', name: 'CEO', photoURL: '', status: 'founder', approved: true, businessLimit: 999, workerLimit: 999, ownerId: uid, isOwner: true, source: 'accountAccess' };
      // Deliberately left unset: window.click360AccessState.
      // accessInfo() defaults to {mode:'founder', plan:'founder', ...}
      // when it's absent -- the internal platform founder scenario that
      // produced the "Funciones de tu plan: -" bug.

      const realData = {
        businesses: [{ id: 'biz_main', name: 'CLICK 360 HQ', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, settings: {}, logistics: {},
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realData, context);

      window.click360Route('access');
      const accessHTML = document.getElementById('app').innerHTML;
      // Scope strictly to the "Funciones de tu plan" card -- matching
      // anywhere in accessHTML risks a false pass from unrelated <li>
      // elements in the shell/nav chrome that surrounds every view.
      const featuresSection = accessHTML.slice(accessHTML.indexOf('Funciones de tu plan'), accessHTML.indexOf('Funciones de tu plan') + 4000);

      return {
        wasGated: location.hash === '#legalGate',
        accessHTMLLength: accessHTML.length,
        hasFeaturesSection: accessHTML.includes('Funciones de tu plan'),
        hasBareBulletBug: /Incluidas[\s\S]{0,20}<li>\s*-?\s*<\/li>/.test(featuresSection) || /<li>\s*-\s*<\/li>/.test(featuresSection),
        hasRealFeatureText: featuresSection.includes('Todo Business') || featuresSection.includes('Trabajadores') || featuresSection.includes('trabajadores') || /<li>[A-Za-zÁÉÍÓÚñÑ]{4,}/.test(featuresSection),
      };
    }, uid);

    assert(!result.wasGated, '#access must not be intercepted by the legal-acceptance gate once a matching acceptance record exists');
    assert(result.accessHTMLLength > 200, `#access must render real content (got ${result.accessHTMLLength} chars)`);
    assert(result.hasFeaturesSection, '#access must render the "Funciones de tu plan" section at all');
    assert(!result.hasBareBulletBug, '#access must not render an empty "-" feature bullet for the internal founder account');
    assert(result.hasRealFeatureText, '#access must render a real, non-empty feature list for the internal founder account (this is the exact "Funciones de tu plan: -" bug)');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 founder-plan-features E2E PASS: the internal platform founder account (status "founder", no direct PLAN_CATALOG entry) now sees a real "Funciones de tu plan" feature list resolved through founder_legacy instead of an empty bullet.');
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
