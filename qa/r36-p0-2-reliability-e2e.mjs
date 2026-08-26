import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * P0-2 (SHARY "todo en 0" / "no puedo cerrar caja" incident).
 *
 * Root cause: cashView()/homeView() computed money totals and day-started
 * status straight off `state`, with zero distinction between "state is
 * still the empty seed() set by click360SetTenantContext(...,
 * {deferLocalLoad:true})" and "state is the real, hydrated snapshot and
 * genuinely has zero movements today." A tenant with an already-open cash
 * session and real sales would render as if the day had never started --
 * hiding the close-day button entirely -- for as long as `state` was still
 * the seed (any render that raced ahead of the real Firestore pull).
 *
 * Separately: a cash session left open on a PRIOR day (the owner never
 * closed yesterday's caja) was permanently invisible and unreachable --
 * every cash-close code path hardcoded date=today(), so starting a new day
 * just opened a second, disconnected session on top of the orphaned one,
 * with no way to ever close it through the UI.
 *
 * This test drives the real app.js in a browser (no Firebase network calls
 * -- state is injected directly through the same window.click360* hooks
 * the real boot sequence uses) and proves both fixes.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_P0_2_E2E_PORT || 4722);
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

    const uid = 'test-p0-2-uid';
    const result = await page.evaluate((uid) => {
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'test@example.com', role: 'owner', name: 'Test', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };

      window.click360Route('home');
      const homeBeforeHTML = document.getElementById('app').innerHTML;
      window.click360Route('cash');
      const cashBeforeHTML = document.getElementById('app').innerHTML;

      // The seeded business below has settings:{} (no timeZone), so the
      // real app's today()/businessTimeZone() resolve to the default
      // 'America/Guayaquil' -- NOT the CI runner's UTC clock. "Yesterday"
      // must be keyed the same way the app itself computes a date (app.js
      // localDateKey(): Intl.DateTimeFormat en-CA in the business
      // timezone), or this fixture only agrees with cashView()'s own
      // "today" during the ~19h/day window where UTC and Ecuador share the
      // same calendar date -- and disagrees deterministically during the
      // other ~5h/day (UTC already next-day, Ecuador not yet). Subtracting
      // exactly 24h always crosses exactly one Ecuador calendar boundary
      // (no DST), so converting THAT instant to the Ecuador calendar date
      // is a correct "yesterday" regardless of when the test runs.
      const businessDateKey = (date, timeZone = 'America/Guayaquil') =>
        new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      const yesterday = businessDateKey(new Date(Date.now() - 86400000));
      const realData = {
        businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto real', qty: 10, stock: 10, price: 5 }],
        sales: [{ id: 's1', businessId: 'biz_main', date: yesterday, status: 'completado', total: 25, method: 'Efectivo', items: [], cashSessionId: 'cs1' }],
        movements: [{ id: 'm1', businessId: 'biz_main', date: yesterday, kind: 'apertura', amount: 20, cashSessionId: 'cs1' }],
        cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: yesterday, status: 'open', openedBy: 'Test' }],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, settings: {}, logistics: {},
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realData, context);

      window.click360Route('home');
      const homeAfterHTML = document.getElementById('app').innerHTML;
      window.click360Route('cash');
      const cashAfterHTML = document.getElementById('app').innerHTML;

      return {
        homeBeforeHasSyncingCard: homeBeforeHTML.includes('Sincronizando'),
        homeBeforeShowsZeroKpi: /Ventas de hoy[\s\S]{0,80}\$0\.00/.test(homeBeforeHTML),
        cashBeforeHasSyncingCard: cashBeforeHTML.includes('siguen sincronizando'),
        cashBeforeShowsIniciarJornada: cashBeforeHTML.includes('Iniciar Jornada'),
        cashAfterHasSyncingCard: cashAfterHTML.includes('siguen sincronizando'),
        cashAfterShowsStaleWarning: cashAfterHTML.includes('sin cerrar') && cashAfterHTML.includes(yesterday),
        cashAfterHasCloseStaleBtn: cashAfterHTML.includes('closeStaleCashBtn') && cashAfterHTML.includes(yesterday),
        isHydratedAfter: window.click360IsTenantDataHydrated(),
      };
    }, uid);

    assert(result.cashBeforeHasSyncingCard, 'cashView must show the syncing card before real data is ever applied, not "Iniciar Jornada" or $0 totals');
    assert(!result.cashBeforeShowsIniciarJornada, 'cashView must NOT show "Iniciar Jornada" while state is still the empty seed -- this is the exact SHARY bug (hides her real open session)');
    assert(result.homeBeforeHasSyncingCard, 'homeView must show the syncing card before real data is ever applied');
    assert(!result.homeBeforeShowsZeroKpi, 'homeView must never show $0.00 as a confirmed "Ventas de hoy" KPI before hydration');
    assert(!result.cashAfterHasSyncingCard, 'cashView must show the real cash screen once real data has been applied');
    assert(result.isHydratedAfter, 'tenantDataHydrated must flip true after click360ApplyTenantState is called with a real snapshot');
    assert(result.cashAfterShowsStaleWarning, 'cashView must surface a cash session left open on a PRIOR day with its real date -- not silently offer to start a fresh, disconnected day');
    assert(result.cashAfterHasCloseStaleBtn, 'cashView must offer a date-specific "Cerrar caja del <date>" action for the stale session');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 P0-2 reliability E2E PASS: money views never show 0/Iniciar-Jornada before real data is hydrated, and a prior-day unclosed cash session is surfaced with a real close path instead of being silently orphaned');
  } finally {
    await browser.close();
  }
}

// r37.2.2 (P0, real SHARY incident -- fixture bug, not a product bug):
// proves the fixture's own `yesterday` construction above stays correct
// regardless of the CI runner's real wall-clock time, by pinning the
// BROWSER's clock (Playwright's page.clock.pauseAt, so the app's own
// `new Date()` calls agree with this test's) to two moments straddling
// Ecuador midnight. Before the fixture fix (raw
// `new Date(Date.now()-86400000).toISOString().slice(0,10)`, the UTC
// calendar date), this would fail deterministically for any pinned instant
// where UTC's calendar date is already ahead of Ecuador's.
async function runMidnightBoundaryScenario() {
  const CASES = [
    { label: '23:59:00 Ecuador on 2026-08-25 (UTC already 2026-08-26T04:59:00Z)', utcIso: '2026-08-26T04:59:00.000Z' },
    { label: '00:01:00 Ecuador on 2026-08-26 (UTC already 2026-08-26T05:01:00Z)', utcIso: '2026-08-26T05:01:00.000Z' }
  ];
  const browser = await chromium.launch();
  try {
    for (const testCase of CASES) {
      const context = await browser.newContext({ timezoneId: 'UTC' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.clock.pauseAt(new Date(testCase.utcIso));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });

      const uid = `test-midnight-${CASES.indexOf(testCase)}`;
      const result = await page.evaluate(({ uid, utcIso }) => {
        const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
        window.click360SetTenantContext(context, { deferLocalLoad: true });
        window.click360User = { uid, email: 'test@example.com', role: 'owner', name: 'Test', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
        const businessDateKey = (date, timeZone = 'America/Guayaquil') =>
          new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
        const now = new Date(utcIso);
        const yesterday = businessDateKey(new Date(now.getTime() - 86400000));
        window.click360ApplyTenantState({
          businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
          activeBusinessId: 'biz_main',
          products: [{ id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto real', qty: 10, stock: 10, price: 5 }],
          sales: [{ id: 's1', businessId: 'biz_main', date: yesterday, status: 'completado', total: 25, method: 'Efectivo', items: [], cashSessionId: 'cs1' }],
          movements: [{ id: 'm1', businessId: 'biz_main', date: yesterday, kind: 'apertura', amount: 20, cashSessionId: 'cs1' }],
          cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: yesterday, status: 'open', openedBy: 'Test' }],
          dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
          tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
          restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
          legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: now.toISOString(), source: 'onboarding' }],
          finance: {}, settings: {}, logistics: {},
          updatedAtMs: now.getTime(), updatedAt: now.toISOString()
        }, context);
        window.click360Route('cash');
        const html = document.getElementById('app').innerHTML;
        return {
          yesterday,
          hasStaleWarning: html.includes('sin cerrar') && html.includes(yesterday),
          hasCloseStaleBtn: html.includes('closeStaleCashBtn') && html.includes(yesterday)
        };
      }, { uid, utcIso: testCase.utcIso });

      assert(result.hasStaleWarning, `[${testCase.label}] cashView must surface the prior-day (${result.yesterday}) unclosed session regardless of the CI runner's real wall-clock time`);
      assert(result.hasCloseStaleBtn, `[${testCase.label}] cashView must offer the date-specific close action for ${result.yesterday}`);
      if (pageErrors.length) throw new Error(`[${testCase.label}] unexpected page errors: ${JSON.stringify(pageErrors)}`);
      console.log(`CLICK 360 P0-2 reliability midnight-boundary PASS: ${testCase.label}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run();
  await runMidnightBoundaryScenario();
} finally {
  server.kill('SIGTERM');
}
