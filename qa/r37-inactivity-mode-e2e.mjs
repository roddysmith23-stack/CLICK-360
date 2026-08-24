import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37 (#91): live-browser proof that the inactivity watch actually behaves
 * correctly, not just that the source mentions the right pieces (see
 * qa-r37-inactivity-mode-harness.cjs for the structural side):
 *  - a 'personal' device (the default) never logs out, no matter how long
 *    it sits idle;
 *  - a 'shared_terminal' device logs out after the configured timeout once
 *    genuinely idle;
 *  - a 'shared_terminal' device with an active sell-cart draft NEVER logs
 *    out while that draft exists -- it defers instead of discarding it.
 *
 * Uses window.CLICK360_DEVICE_MODE.__setMsPerMinuteForTesting() so a
 * "3 minute" timeout resolves in milliseconds instead of requiring the test
 * to wait real minutes.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_INACTIVITY_MODE_E2E_PORT || 4735);
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

function baseTenantSetup(uid) {
  return {
    context: { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 },
    data: {
      businesses: [{ id: 'biz_main', name: 'Tienda Real', status: 'activo', type: 'ropa', settings: {} }],
      activeBusinessId: 'biz_main',
      products: [], sales: [], movements: [], cashSessions: [],
      dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
      tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
      restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: null, privacyVersion: null, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
      finance: {}, logistics: {},
      settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} } },
      updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
    }
  };
}

async function setupSession(page, uid) {
  const { context, data } = baseTenantSetup(uid);
  await page.evaluate(({ context, data, uid }) => {
    // This synthetic harness injects tenant state directly and never
    // performs a real Firebase sign-in. The real SDK's own
    // auth.onAuthStateChanged still fires asynchronously in the background
    // and resolves with user=null a moment later, which would otherwise
    // call the real logout teardown (click360ClearTenantContext) and wipe
    // the injected session out from under this test -- a test-harness-only
    // artifact (see qa/r37-workers-registration-visibility-e2e.mjs for the
    // same root cause), not something a real authenticated user ever hits.
    window.click360ClearTenantContext = () => {};
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
    let logoutCalls = 0;
    window.click360Logout = async () => { logoutCalls += 1; };
    window.__click360TestLogoutCalls = () => logoutCalls;
    window.click360ApplyTenantState(data, context);
    window.click360Route('home');
  }, { context, data, uid });
}

async function scenarioPersonalDeviceNeverLogsOut(page) {
  await setupSession(page, 'test-r37-inactivity-personal-uid');
  const result = await page.evaluate(async () => {
    window.CLICK360_DEVICE_MODE.set('personal');
    window.CLICK360_DEVICE_MODE.__setMsPerMinuteForTesting(20);
    window.CLICK360_DEVICE_MODE.setInactivityMinutes(3);
    window.CLICK360_DEVICE_MODE.startInactivityWatch();
    window.CLICK360_DEVICE_MODE.scheduleInactivityCheck();
    await new Promise((resolve) => setTimeout(resolve, 3 * 20 + 300));
    return { logoutCalls: window.__click360TestLogoutCalls(), mode: window.CLICK360_DEVICE_MODE.get() };
  });
  assert(result.mode === 'personal', 'device mode must actually be "personal" for this scenario');
  assert(result.logoutCalls === 0, `a personal device must NEVER auto-logout, no matter how long it sits idle, got logoutCalls=${result.logoutCalls}`);
}

async function scenarioSharedTerminalLogsOutWhenIdle(page) {
  await setupSession(page, 'test-r37-inactivity-idle-uid');
  const result = await page.evaluate(async () => {
    window.CLICK360_DEVICE_MODE.set('shared_terminal');
    window.CLICK360_DEVICE_MODE.__setMsPerMinuteForTesting(20);
    window.CLICK360_DEVICE_MODE.setInactivityMinutes(3);
    window.CLICK360_DEVICE_MODE.startInactivityWatch();
    window.CLICK360_DEVICE_MODE.scheduleInactivityCheck();
    await new Promise((resolve) => setTimeout(resolve, 3 * 20 + 300));
    return { logoutCalls: window.__click360TestLogoutCalls() };
  });
  assert(result.logoutCalls === 1, `a shared_terminal device with no draft/pending operation must auto-logout exactly once after the configured idle timeout, got logoutCalls=${result.logoutCalls}`);
}

async function scenarioSharedTerminalNeverAbandonsDraft(page) {
  await setupSession(page, 'test-r37-inactivity-draft-uid');
  const result = await page.evaluate(async () => {
    window.CLICK360_DEVICE_MODE.set('shared_terminal');
    window.CLICK360_DEVICE_MODE.__setMsPerMinuteForTesting(20);
    window.CLICK360_DEVICE_MODE.setInactivityMinutes(3);
    // Simulate an in-progress sale: a non-empty cart draft.
    window.click360SellCartCount = () => 2;
    window.CLICK360_DEVICE_MODE.startInactivityWatch();
    window.CLICK360_DEVICE_MODE.scheduleInactivityCheck();
    // Wait well past several would-be idle cycles.
    await new Promise((resolve) => setTimeout(resolve, 3 * 20 * 4));
    const stillNoLogout = window.__click360TestLogoutCalls() === 0;
    // Now clear the draft and confirm it DOES eventually log out -- proving
    // the earlier silence was a genuine defer, not a broken/dead timer.
    window.click360SellCartCount = () => 0;
    await new Promise((resolve) => setTimeout(resolve, 3 * 20 + 300));
    return { stillNoLogout, logoutCallsAfterDraftCleared: window.__click360TestLogoutCalls() };
  });
  assert(result.stillNoLogout, 'a shared_terminal device must NEVER auto-logout while a sell-cart draft is active, even across several would-be idle cycles');
  assert(result.logoutCallsAfterDraftCleared === 1, `once the draft is cleared, the SAME still-idle device must log out on the next cycle (proving the earlier silence was a defer, not a dead/broken timer), got logoutCalls=${result.logoutCallsAfterDraftCleared}`);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.CLICK360_DEVICE_MODE?.set === 'function', { timeout: 15000 });

    await scenarioPersonalDeviceNeverLogsOut(page);
    await scenarioSharedTerminalLogsOutWhenIdle(page);
    await scenarioSharedTerminalNeverAbandonsDraft(page);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37 inactivity-mode E2E PASS: a personal device (the default) never auto-logs-out no matter how long it idles; a shared/POS-terminal device logs out after its configured timeout once genuinely idle; and the SAME terminal never abandons an active sell-cart draft, deferring the logout until the draft is actually cleared.');
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
