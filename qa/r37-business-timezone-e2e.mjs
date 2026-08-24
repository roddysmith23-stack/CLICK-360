import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 50, world-ready): the onboarding form already lets a new
 * customer pick Colombia/Peru/Mexico/US/Spain as their business timezone
 * (business.settings.timeZone), and businessTimeZone() correctly reads
 * that value for DISPLAY purposes (clock, formatted dates). But
 * localDateKey()/today() -- the function that actually stamps the `date`
 * field on every sale/cash-session/movement -- was hardcoded to a
 * module-level `America/Guayaquil` constant, completely independent of
 * the business's own configured timezone. A hypothetical Mexico City
 * customer's sales would be dated using Ecuador's clock, not their own.
 *
 * Every real production tenant today (SHARY, Lia, etc.) is genuinely in
 * America/Guayaquil, so this bug never manifested for them -- the fix is
 * a no-op for current customers and only changes behavior for a business
 * configured to a different timezone.
 *
 * This test drives the real app.js in a browser, sets a business with
 * settings.timeZone = 'America/Mexico_City' (UTC-6, no DST), and checks
 * that window.click360LocalDateKey() resolves the MEXICO-local date at an
 * instant where Mexico and Ecuador (UTC-5) genuinely disagree on what day
 * it is: 2026-08-23T05:30:00Z is already 00:30 on Aug 23 in Ecuador, but
 * still 23:30 on Aug 22 in Mexico City.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_BUSINESS_TZ_E2E_PORT || 4732);
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
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360LocalDateKey === 'function', { timeout: 15000 });

    const uid = 'test-r37-business-tz-uid';
    const result = await page.evaluate((uid) => {
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };

      const realDataMexico = {
        businesses: [{ id: 'biz_main', name: 'Tienda CDMX', status: 'activo', type: 'ropa', settings: { timeZone: 'America/Mexico_City' } }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, settings: {}, logistics: {},
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realDataMexico, context);

      const instant = '2026-08-23T05:30:00.000Z';
      const mexicoDateKey = window.click360LocalDateKey(new Date(instant));

      // Same instant, but the business is now Ecuador -- must resolve
      // differently (proving the timezone is actually READ from the
      // business, not just always returning the same hardcoded string).
      const realDataEcuador = { ...realDataMexico, businesses: [{ ...realDataMexico.businesses[0], settings: { timeZone: 'America/Guayaquil' } }] };
      window.click360ApplyTenantState(realDataEcuador, context);
      const ecuadorDateKey = window.click360LocalDateKey(new Date(instant));

      return { mexicoDateKey, ecuadorDateKey };
    }, uid);

    assert(result.mexicoDateKey === '2026-08-22', `A business configured to America/Mexico_City must date a sale at 2026-08-23T05:30:00Z as 2026-08-22 (still 23:30 the prior day in Mexico City), got ${result.mexicoDateKey}`);
    assert(result.ecuadorDateKey === '2026-08-23', `A business configured to America/Guayaquil must date the SAME instant as 2026-08-23 (already 00:30 the next day in Ecuador), got ${result.ecuadorDateKey}`);
    assert(result.mexicoDateKey !== result.ecuadorDateKey, 'localDateKey() must actually depend on the business\'s own configured timezone, not a hardcoded constant -- two businesses in different zones must disagree at this instant');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 business-timezone E2E PASS: localDateKey()/today() now resolves the business\'s OWN configured timezone (business.settings.timeZone), not a hardcoded America/Guayaquil constant -- a no-op for existing Ecuador-based tenants, correct for any future customer in a different timezone.');
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
