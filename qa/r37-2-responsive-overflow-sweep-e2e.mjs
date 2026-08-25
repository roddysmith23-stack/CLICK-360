import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

/**
 * r37.2 (Section 21, "RESPONSIVE REAL"): a POS is used on real phones behind
 * a real counter -- a single sideways scrollbar on the sell screen or the
 * cash drawer is a genuine "this app is broken" moment for a business owner
 * mid-transaction. This drives the REAL app.js through the real offline
 * synthetic-session harness (no login, no mocked app logic -- only network
 * is blocked so the real Firebase Auth SDK never wipes the synthetic
 * session) across every commercially-relevant screen and asserts
 * document.documentElement.scrollWidth never exceeds the viewport width at
 * any of the widths real customers actually carry: 320-430 (phones),
 * 768-1024 (tablets), 1280-1440 (desktop/laptop).
 *
 * Harness notes (same pattern as qa/r37-worker-access-gate-e2e.mjs and
 * qa/r37-2-worker-invite-message-e2e.mjs -- read those first if touching
 * this file):
 *  - Real outbound network requests are blocked so the real Firebase Auth
 *    SDK never resolves a background "user=null" a few seconds in, which
 *    would otherwise wipe the synthetic tenant state or trigger a real
 *    page reload via the hidden #click360-auth-gate form.
 *  - window.click360WriteGate is overridden to report allowed:true -- this
 *    is the one exposed CLIENT-SIDE UX seam; real write enforcement is
 *    firestore.rules, server-side, untouched by this test.
 *  - window.click360IsPlatformAdmin is backed by window.click360User.email
 *    (real, client-side UI-gate only -- real enforcement is
 *    firestore.rules' isPlatformAdmin(), untouched); this test sets that
 *    email only for the ceoAdmin scenario so that surface's real layout
 *    gets swept too, matching "ceoAdmin (if reachable)" in the mission.
 */

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_RESPONSIVE_SWEEP_E2E_PORT || 4762);
const url = `http://127.0.0.1:${port}/index.html`;
const output = path.join(root, 'output/playwright/r37-2-responsive');
const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440];
const SCREENSHOT_WIDTHS = new Set([390, 1440]);

const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('App did not start.');
}

function assert(condition, message) { if (!condition) throw new Error(message); }

const OWNER_UID = 'test-r37-2-responsive-owner-uid';
const CEO_ADMIN_EMAIL = 'roddysmithceo@gmail.com';

function fixtureState() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowIso = now.toISOString();
  return {
    todayStr,
    state: {
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [
        { id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto Responsive de Prueba con Nombre Largo', qty: 25, stock: 25, price: 12.5, cardPrice: 13.25, category: 'General' },
        { id: 'p2', businessId: 'biz_main', code: 'P2', name: 'Segundo Producto', qty: 8, stock: 8, price: 4.75, category: 'General' }
      ],
      sales: [{ id: 'sale1', businessId: 'biz_main', date: todayStr, when: nowIso, status: 'paid', total: 12.5, received: 12.5, balance: 0, items: [{ id: 'p1', name: 'Producto Responsive de Prueba con Nombre Largo', code: 'P1', qty: 1, price: 12.5 }], customer: 'Cliente de prueba', customerPhone: '', payments: [] }],
      movements: [
        { id: 'm1', businessId: 'biz_main', date: todayStr, kind: 'apertura', amount: 50, cashSessionId: 'cs1', when: nowIso, status: 'ok' },
        { id: 'm2', businessId: 'biz_main', date: todayStr, kind: 'ingreso', amount: 12.5, paymentMethod: 'Efectivo', cashSessionId: 'cs1', when: nowIso, status: 'ok' }
      ],
      cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: todayStr, status: 'open', openedBy: 'Owner', openedAt: nowIso }],
      dailyReports: [], deletedProducts: [], auditLogs: [],
      layaways: [{ id: 'lay1', saleId: 'sale2', businessId: 'biz_main', status: 'active', total: 40, paid: 10, balance: 30, payments: [{ amount: 10, method: 'Efectivo', when: nowIso }], customerSnapshot: { name: 'Cliente Apartado', phone: '593969399562' }, itemsSnapshot: [{ name: 'Producto Responsive de Prueba con Nombre Largo', code: 'P1', qty: 1 }], pickupDueAt: todayStr, createdAt: nowIso }],
      invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid: OWNER_UID, termsVersion: undefined, privacyVersion: undefined, acceptedAt: nowIso, source: 'onboarding' }],
      finance: {
        payments: [{ id: 'fin1', businessId: 'biz_main', name: 'Arriendo local', category: 'Arriendo', amount: 350, status: 'pending', dueDate: todayStr, createdAt: nowIso, operationId: 'op1' }],
        goals: [{ id: 'fin2', businessId: 'biz_main', name: 'Fondo de emergencia', targetAmount: 1000, savedAmount: 250, status: 'active', createdAt: nowIso, operationId: 'op2' }]
      },
      logistics: {},
      settings: {
        onboarding: { completedAt: nowIso, operationId: 'x', version: 16.2, checklist: {} },
        workers: [{ uid: 'w1', name: 'Trabajador de Prueba', email: 'trabajador@example.com', role: 'cashier', status: 'active' }],
        labelTemplates: []
      },
      updatedAtMs: Date.now(), updatedAt: nowIso
    }
  };
}

function collectUnexpectedErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Diagnostic helper: when overflow is detected, this walks every element
 * and reports the widest offenders (right edge past the viewport) so a
 * real fix can be targeted at the actual CSS class/id causing it, instead
 * of guessing.
 */
function overflowDiagnosticsScript() {
  return `(() => {
    const clientWidth = document.documentElement.clientWidth;
    // position:fixed elements (e.g. the floating calculator button) are
    // positioned relative to the viewport, not document flow, and do NOT
    // contribute to document.documentElement.scrollWidth in this engine --
    // walk ancestors and skip anything rooted under a fixed-position node
    // so the reported offenders are the REAL, in-flow cause of the
    // overflow (matches empirical testing: hiding a fixed offender never
    // changes scrollWidth).
    const hasFixedAncestor = (el) => {
      let node = el;
      while (node && node !== document.body) {
        if (getComputedStyle(node).position === 'fixed') return true;
        node = node.parentElement;
      }
      return false;
    };
    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (hasFixedAncestor(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.right > clientWidth + 1 && rect.width > 0) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '',
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        });
      }
    });
    offenders.sort((a, b) => b.right - a.right);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth, offenders: offenders.slice(0, 5) };
  })()`;
}

const routes = [
  { key: 'home', route: 'home' },
  { key: 'inventory', route: 'inventory' },
  {
    key: 'sell',
    route: 'sell',
    setup: async (page) => {
      await page.fill('#manualCode', 'P1');
      await page.click('#addCode');
      await page.waitForFunction(() => !document.querySelector('#cartItems .empty'), { timeout: 20000 });
    }
  },
  { key: 'cash', route: 'cash' },
  { key: 'apartados', route: 'debtors' },
  { key: 'finance', route: 'finance' },
  { key: 'activity', route: 'activity' },
  { key: 'reports', route: 'reports' },
  { key: 'workers', route: 'workers' },
  {
    key: 'printing-label-editor',
    route: 'printing',
    setup: async (page) => {
      await page.waitForSelector('#printingLabelAction:not([disabled])', { timeout: 20000 });
      await page.click('#printingLabelAction');
      await page.waitForFunction(() => !!document.querySelector('.modalOverlay, #modalRoot .modal, .modal'), { timeout: 20000 });
    }
  },
  { key: 'settings', route: 'settings' },
  { key: 'mi-plan', route: 'access' },
  { key: 'help', route: 'help' },
  {
    key: 'ceoAdmin',
    route: 'ceoAdmin',
    setup: async (page) => {
      await page.evaluate((email) => { if (window.click360User) window.click360User.email = email; }, CEO_ADMIN_EMAIL);
    },
    beforeRoute: true
  }
];

async function applySyntheticSession(page) {
  const { state, todayStr } = fixtureState();
  await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });
  await page.evaluate(({ uid, state }) => {
    document.getElementById('click360-auth-gate')?.remove();
    window.click360ClearTenantContext = () => {};
    window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
    const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner Responsive', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    state.legalAcceptances.forEach((legal) => {
      legal.termsVersion = window.CLICK360_V16_DOMAIN?.TERMS_VERSION;
      legal.privacyVersion = window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION;
    });
    window.click360ApplyTenantState(state, context);
  }, { uid: OWNER_UID, state });
  return todayStr;
}

async function sweepRoute(page, browserName, routeDef, failures) {
  if (!routeDef.beforeRoute) {
    await page.evaluate((r) => window.click360Route(r), routeDef.route);
    await page.waitForFunction((r) => location.hash === '#' + r || location.hash === '#legalGate' || location.hash === '#workerAccessGate', routeDef.route, { timeout: 60000 });
  }
  if (routeDef.setup) await routeDef.setup(page);
  if (routeDef.beforeRoute) {
    await page.evaluate((r) => window.click360Route(r), routeDef.route);
    await page.waitForFunction((r) => location.hash === '#' + r, routeDef.route, { timeout: 60000 });
  }

  const reachedHash = await page.evaluate(() => location.hash);
  if (reachedHash !== '#' + routeDef.route) {
    failures.push(`[${browserName}] route "${routeDef.key}" did not reach #${routeDef.route} (real client-side routing/gate redirected to ${reachedHash}) -- skipping its width sweep.`);
    return;
  }

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Real layout settles on the next frame after a viewport/media-query
    // change; poll briefly instead of a fixed sleep to avoid flakiness.
    await page.waitForTimeout(60);
    const result = await page.evaluate(overflowDiagnosticsScript());
    if (result.scrollWidth > result.clientWidth + 1) {
      const offenderText = result.offenders.map((o) => `<${o.tag}${o.id ? '#' + o.id : ''}${o.cls ? '.' + o.cls.split(' ').filter(Boolean).slice(0, 3).join('.') : ''} right=${o.right}px width=${o.width}px>`).join(', ');
      failures.push(`[${browserName}] OVERFLOW route="${routeDef.key}" width=${width}px scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth} offenders: ${offenderText || '(none identified)'}`);
    }
    if (SCREENSHOT_WIDTHS.has(width)) {
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `${routeDef.key}-${width}-${browserName}.png`), fullPage: false });
    }
  }
}

async function runBrowser(browserType, browserName) {
  const browser = await browserType.launch();
  const failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const pageErrors = collectUnexpectedErrors(page);
    if (process.env.CLICK360_RESPONSIVE_SWEEP_DEBUG === '1') {
      page.on('console', (m) => console.log(`DEBUGCONSOLE[${browserName}]:`, m.text()));
    }
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function', { timeout: 60000 });
    await applySyntheticSession(page);
    // The real boot splash enforces a minimum intro time before it removes
    // itself (see index.html); it can still intercept the first real click
    // for a moment even after #app has rendered. Wait for it to fully
    // detach before driving any real button clicks.
    await page.waitForSelector('#click360Splash', { state: 'detached', timeout: 30000 }).catch(() => {});

    for (const routeDef of routes) {
      await sweepRoute(page, browserName, routeDef, failures);
    }

    if (pageErrors.length) failures.push(`[${browserName}] unexpected page errors: ${JSON.stringify(pageErrors)}`);
  } finally {
    await browser.close();
  }
  return failures;
}

async function run() {
  await mkdir(output, { recursive: true });
  await waitForServer();

  const allFailures = [];
  allFailures.push(...await runBrowser(chromium, 'chromium'));

  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit responsive sweep (SKIP_WEBKIT=1).');
  } else {
    allFailures.push(...await runBrowser(webkit, 'webkit'));
  }

  if (allFailures.length) {
    console.error(`CLICK 360 r37.2 responsive-overflow-sweep E2E FAIL (${allFailures.length} finding(s)):`);
    allFailures.forEach((f) => console.error(' - ' + f));
    throw new Error(`${allFailures.length} responsive overflow finding(s). See above.`);
  }

  console.log(`CLICK 360 r37.2 responsive-overflow-sweep E2E PASS: no horizontal overflow (scrollWidth <= viewport width) across ${widths.length} widths (${widths.join(', ')}) x ${routes.length} routes (${routes.map((r) => r.key).join(', ')}) in Chromium${process.env.SKIP_WEBKIT === '1' ? '' : ' + WebKit'}. Screenshots at 390/1440 saved to output/playwright/r37-2-responsive/.`);
}

try {
  await run();
} finally {
  server.kill('SIGTERM');
}
