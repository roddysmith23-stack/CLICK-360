import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (Section 7, real error err_5286e4d9-722a-486b-8f9c-561dc2ba16f1 at
 * #reminders, Safari 27.0 standalone, founder/authenticated).
 *
 * Root cause: notificationItems()/reminderCards() called
 * window.CLICK360_V16_DOMAIN.formatBusinessDate(...) and .normalizePhone(...)
 * directly, guarded only by a single `?.` on the property lookup -- not on
 * the call itself throwing. formatBusinessDate ultimately constructs an
 * Intl.DateTimeFormat with the business's stored timeZone; an invalid or
 * corrupted timeZone string (or a malformed dueAt) throws synchronously,
 * which crashed the whole #reminders render with no recovery.
 *
 * This test drives the real app.js in a browser, injects a tenant whose
 * business.settings.timeZone is corrupted (a VALID reminder dueAt is
 * required to actually reach the Intl.DateTimeFormat call --
 * formatBusinessDate short-circuits on an unparseable date before ever
 * touching timeZone), then navigates to #reminders and proves the route
 * still renders (not a blank/crashed page) and throws no page error --
 * exactly the scenario that produced err_5286e4d9.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_REMINDERS_CRASH_E2E_PORT || 4726);
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

    const uid = 'test-r37-reminders-uid';
    const result = await page.evaluate((uid) => {
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'test@example.com', role: 'owner', name: 'Test', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };

      const realData = {
        businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: { timeZone: 'Not/AValidZone-Corrupted' } }],
        activeBusinessId: 'biz_main',
        products: [],
        sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: {
          reminders: [
            { id: 'rem1', businessId: 'biz_main', title: 'Cobro Doña Rosa', type: 'cobro', dueAt: '2026-09-01T15:00:00.000Z', phone: '0999999999', notes: 'Prueba r37', amount: 25 },
            { id: 'rem2', businessId: 'biz_main', title: 'Sin fecha ni telefono', type: 'tarea', dueAt: '', phone: '' }
          ]
        },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realData, context);

      window.click360Route('reminders');
      const remindersHTML = document.getElementById('app').innerHTML;

      return {
        remindersHTMLLength: remindersHTML.length,
        hasReminderTitle: remindersHTML.includes('Cobro Doña Rosa'),
        hasSecondReminder: remindersHTML.includes('Sin fecha ni telefono'),
        hasCrashArtifact: remindersHTML.includes('undefined') && remindersHTML.includes('NaN'),
      };
    }, uid);

    assert(result.remindersHTMLLength > 200, `#reminders must render real content, not a blank/crashed page (got ${result.remindersHTMLLength} chars)`);
    assert(result.hasReminderTitle, '#reminders must render a reminder with a malformed dueAt without crashing the whole route');
    assert(result.hasSecondReminder, '#reminders must render a reminder with empty dueAt/phone without crashing');

    if (pageErrors.length) throw new Error(`#reminders must not throw a page error on a corrupted timeZone + malformed dueAt (this is exactly err_5286e4d9): ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 #reminders safe-format E2E PASS: a corrupted business timeZone and a malformed reminder dueAt/phone no longer crash the #reminders route (safeFormatBusinessDate/safeNormalizePhone/businessTimeZone all degrade gracefully instead of throwing).');
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
