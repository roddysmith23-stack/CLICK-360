import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { devices, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_SHARY_CLOSE_SAVE_E2E_PORT || 4742);
const url = `http://127.0.0.1:${port}/index.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Synthetic CLICK 360 server did not start.');
}

function fixtureSource() {
  return ({ targetBytes = 838800, serverClosed = false } = {}) => {
    const uid = 'synthetic-shary-owner';
    const businessId = 'synthetic-shary-business';
    const context = { authUid:uid, ownerUid:uid, ownerId:uid, businessId:uid, tenantKey:`owner:${uid}:business:${uid}`, schemaVersion:10 };
    const products = Array.from({ length:463 }, (_, index) => ({ id:`product-${index}`, businessId, code:`P-${index}`, name:`Synthetic product ${index}`, stock:index === 0 ? 0 : 3, qty:index === 0 ? 0 : 3, price:index === 0 ? 33 : 1, notes:'n'.repeat(120) }));
    const sales = Array.from({ length:29 }, (_, index) => ({ id:`old-sale-${index}`, operationId:`old-op-${index}`, businessId, date:'2026-09-02', status:'paid', total:1, method:'Efectivo', cashSessionId:`old-cash-${index % 23}`, items:[] }));
    sales.push({ id:'sale-0903', operationId:'sale-op-0903', businessId, date:'2026-09-03', status:'paid', total:30, method:'Transferencia', cashSessionId:'cash-0903', items:[{ productId:'product-0', name:'Synthetic product 0', qty:1, price:33 }] });
    const movements = Array.from({ length:105 }, (_, index) => ({ id:`old-movement-${index}`, operationId:`old-movement-${index}`, businessId, date:'2026-09-02', kind:'ingreso', amount:1, cashSessionId:`old-cash-${index % 23}` }));
    movements.push({ id:'open-0903', operationId:'open-0903', businessId, date:'2026-09-03', kind:'apertura', amount:0, cashSessionId:'cash-0903' });
    movements.push({ id:'movement-0903', operationId:'sale-op-0903', saleId:'sale-0903', businessId, date:'2026-09-03', kind:'ingreso', amount:30, paymentMethod:'Transferencia', cashSessionId:'cash-0903' });
    const cashSessions = Array.from({ length:23 }, (_, index) => ({ id:`old-cash-${index}`, businessId, date:'2026-09-02', status:'closed', openedAt:'2026-09-25T10:00:00.000Z', closedAt:'2026-09-25T11:00:00.000Z', reportId:`old-report-${index % 21}` }));
    cashSessions.push({ id:'cash-0903', operationId:'cash-0903', businessId, date:'2026-09-03', status:'open', openedAt:'2026-09-26T15:51:07.367Z', openingAmount:0, openedBy:'Synthetic Owner' });
    const dailyReports = Array.from({ length:21 }, (_, index) => ({ id:`old-report-${index}`, operationId:`old-report-${index}`, businessId, date:'2026-09-02', status:'closed', cashSessionId:`old-cash-${index}`, closeCash:0, html:`<div>${'historical'.repeat(450)}</div>` }));
    const auditLogs = Array.from({ length:271 }, (_, index) => ({ id:`old-audit-${index}`, action:'historical', businessId, createdAt:'2026-09-25T00:00:00.000Z', details:{ retained:true, note:'audit'.repeat(25) } }));
    const state = {
      businesses:[{ id:businessId, name:'SHARY Synthetic', status:'activo', type:'ropa', lastCashBalance:0, settings:{ timeZone:'America/Guayaquil', logoUrl:`data:image/png;base64,${'A'.repeat(8000)}` } }],
      activeBusinessId:businessId, products, sales, movements, cashSessions, dailyReports, auditLogs,
      deletedProducts:[], layaways:[], invoices:[], tables:[], tableOrders:[], restaurantPayments:[], restaurantPrintHistory:[], restaurantEvents:[], restaurantRecipes:[], labelPrintHistory:[], notifications:[], finance:{}, logistics:{},
      settings:{ workers:[], labelTemplates:[], labelProfiles:[], customers:[], reminders:[], syntheticPadding:'' },
      legalAcceptances:[{ id:'legal-synthetic', businessId, uid, termsVersion:window.CLICK360_V16_DOMAIN.TERMS_VERSION, privacyVersion:window.CLICK360_V16_DOMAIN.PRIVACY_VERSION, acceptedAt:new Date().toISOString(), source:'onboarding' }],
      updatedAtMs:Date.now(), updatedAt:new Date().toISOString()
    };
    const byteSize = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    // normalizeState() adds the runtime's canonical defaults (~8 KB), so
    // the pre-normalization fixture targets 838.8 KB and lands near 847 KB.
    state.settings.syntheticPadding = 'z'.repeat(Math.max(0, targetBytes - byteSize(state)));
    while (byteSize(state) < targetBytes) state.settings.syntheticPadding += 'z';
    while (byteSize(state) > targetBytes + 100) state.settings.syntheticPadding = state.settings.syntheticPadding.slice(0, -1);

    window.click360SetTenantContext(context, { deferLocalLoad:true });
    window.click360User = { uid, email:'synthetic-owner@example.test', role:'owner', name:'Synthetic Owner', status:'founder_legacy', approved:true, ownerId:uid, isOwner:true, source:'accountAccess' };
    window.click360AccessState = { mode:'founder_legacy', plan:'founder_legacy', readOnly:false, source:'synthetic-e2e' };
    window.click360WriteGate = () => ({ allowed:true, reason:'synthetic_e2e' });
    window.__serverPreflightCalls = 0;
    window.__syntheticRemote = null;
    window.click360VerifyCashCloseOnServer = async () => {
      window.__serverPreflightCalls += 1;
      return serverClosed
        ? { ok:true, closed:true, reportId:'server-report-0903', remoteRevision:42 }
        : { ok:true, closed:false, remoteRevision:42 };
    };
    window.click360SyncNow = async () => { window.__syntheticRemote = structuredClone(window.click360GetTenantState()); return true; };
    window.click360RefreshNow = async () => { if (window.__syntheticRemote) window.click360ApplyTenantState(structuredClone(window.__syntheticRemote), context); return true; };
    window.click360GetSyncState = () => ({ status:'clean', blocking:false, hasDirtyFields:false, localHash:'h_same', remoteHash:'h_same' });
    window.click360ApplyTenantState(state, context);
    window.click360Route('cash');
    document.getElementById('click360-auth-gate')?.remove();
    return { beforeBytes:byteSize(window.click360GetTenantState()), productCount:products.length, saleCount:sales.length, movementCount:movements.length };
  };
}

async function createPage(browser) {
  const context = await browser.newContext({ ...devices['iPhone 15'] });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable:true, value:true });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.clock.pauseAt(new Date('2026-09-26T17:45:00.000Z'));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && !!window.CLICK360_CASH_RECONCILIATION, { timeout:15000 });
  return { context, page, pageErrors };
}

async function openAndSubmitCashClose(page, { doubleClick = false, programmaticOpen = false } = {}) {
  if (programmaticOpen) await page.locator('#closeStaleCashBtn').evaluate((button) => button.click());
  else await page.locator('#closeStaleCashBtn').click();
  await page.locator('#closeDayForm').waitFor({ state:'visible' });
  if (doubleClick || programmaticOpen) await page.locator('#closeDaySubmitBtn').evaluate((button, shouldDoubleClick) => { button.click(); if (shouldDoubleClick) button.click(); }, doubleClick);
  else await page.locator('#closeDaySubmitBtn').click();
}

async function stateOutcome(page) {
  return page.evaluate(() => {
    const state = window.click360GetTenantState();
    const reports = state.dailyReports.filter((report) => report.businessId === 'synthetic-shary-business' && report.date === '2026-09-03' && report.status === 'closed');
    const session = state.cashSessions.find((row) => row.id === 'cash-0903');
    return {
      bytes:new TextEncoder().encode(JSON.stringify(state)).byteLength,
      reports:reports.map((report) => ({ id:report.id, hasHtml:Object.hasOwn(report, 'html'), renderVersion:report.renderVersion, saleIds:report.saleIds, cashSessionId:report.cashSessionId })),
      session:{ status:session?.status, reportId:session?.reportId },
      products:state.products.length,
      product0:{ stock:state.products[0].stock, qty:state.products[0].qty },
      sales:state.sales.length,
      movements:state.movements.length,
      preflightCalls:window.__serverPreflightCalls,
      preview:document.querySelector('#pdfContentPreview')?.innerText || '',
      diagnostic:window.click360GetCashCloseDiagnostics?.(),
      storage:window.click360GetStorageState?.() || null,
      headings:[...document.querySelectorAll('h1,h2,h3')].map((node) => node.textContent?.trim()).filter(Boolean)
    };
  });
}

async function run() {
  const browser = await webkit.launch();
  try {
    const rejected = await createPage(browser);
    const rejectedInitial = await rejected.page.evaluate(fixtureSource(), { targetBytes:841500 });
    assert(rejectedInitial.beforeBytes < 850000 && rejectedInitial.beforeBytes > 849000, `rejection fixture must sit immediately below the guard, got ${rejectedInitial.beforeBytes}`);
    await openAndSubmitCashClose(rejected.page);
    await rejected.page.getByRole('heading', { name:'No pudimos cerrar la caja' }).waitFor({ state:'visible', timeout:15000 });
    const rejectedResult = await stateOutcome(rejected.page);
    assert(rejectedResult.reports.length === 0, 'the rejected close must not retain a report');
    assert(rejectedResult.session.status === 'open' && !rejectedResult.session.reportId, 'the rejected close must leave the exact session open');
    assert(rejectedResult.products === 463 && rejectedResult.product0.stock === 0 && rejectedResult.product0.qty === 0, 'the rejected close must not touch inventory');
    assert(rejectedResult.sales === 30 && rejectedResult.movements === 107, 'the rejected close must not duplicate the sale or movement');
    assert(rejectedResult.preflightCalls === 1, 'the rejected close must still check the server before mutation');
    assert(rejectedResult.diagnostic?.stage === 'cash_close_verify_closed', `rejection must retain the failing stage, got ${rejectedResult.diagnostic?.stage}`);
    assert(rejectedResult.diagnostic?.errorCode === 'local_state_too_large', `rejection must expose the real save error, got ${rejectedResult.diagnostic?.errorCode}`);
    assert(rejectedResult.diagnostic?.saveFailure?.code === 'local_state_too_large', 'diagnostic must expose the concrete save failure');
    assert(rejectedResult.diagnostic?.saveFailure?.payloadBytes > 850000 && rejectedResult.diagnostic?.saveFailure?.limitBytes === 850000, 'diagnostic must include attempted bytes and unchanged guard');
    assert(rejectedResult.diagnostic?.writeGate?.allowed === true, 'diagnostic must retain the evaluated write gate');
    assert(rejectedResult.diagnostic?.cashSessionId, 'diagnostic must retain the real session fingerprint');
    assert(rejectedResult.diagnostic?.displayMode === 'standalone', 'iPhone PWA scenario must run in standalone mode');
    assert(rejected.pageErrors.length === 0, `unexpected rejection page errors: ${JSON.stringify(rejected.pageErrors)}`);
    await rejected.context.close();

    const successful = await createPage(browser);
    const { page, pageErrors } = successful;
    const initial = await page.evaluate(fixtureSource(), { targetBytes:838800 });
    assert(initial.productCount === 463 && initial.saleCount === 30 && initial.movementCount === 107, 'the production-shaped fixture counts must be preserved');
    assert(initial.beforeBytes < 850000 && initial.beforeBytes > 846500, `fixture must sit near the guarded limit, got ${initial.beforeBytes}`);

    await openAndSubmitCashClose(page, { doubleClick:true });
    await page.getByRole('heading', { name:'Resumen de Cierre' }).waitFor({ state:'visible', timeout:15000 });
    const result = await stateOutcome(page);
    assert(result.bytes < 850000, `compact close must remain below the existing limit, got ${result.bytes}`);
    assert(result.reports.length === 1, 'double tap must create exactly one report');
    assert(result.reports[0].hasHtml === false && result.reports[0].renderVersion === 'cash-close-structured-v1', 'new report must be structured and compact');
    assert(result.reports[0].cashSessionId === 'cash-0903' && result.reports[0].saleIds.join(',') === 'sale-0903', 'report must remain bound to the exact session and sale');
    assert(result.session.status === 'closed' && result.session.reportId === result.reports[0].id, 'exact session must close once');
    assert(result.products === 463 && result.product0.stock === 0 && result.product0.qty === 0, 'inventory must not be decremented again');
    assert(result.sales === 30 && result.movements === 107, 'sale and movement counts must remain unchanged');
    assert(result.preflightCalls === 1, 'server must be checked once before mutation');
    assert(result.preview.includes('$30.00') || result.preview.includes('$30,00'), 'structured report must reconstruct the $30 transfer summary');

    await mkdir(path.join(root, 'output/playwright'), { recursive:true });
    await page.screenshot({ path:path.join(root, 'output/playwright/shary-cash-close-save-rejected-webkit.png'), fullPage:true });
    assert(pageErrors.length === 0, `unexpected page errors: ${JSON.stringify(pageErrors)}`);
    await successful.context.close();

    const alreadyClosed = await createPage(browser);
    await alreadyClosed.page.evaluate(fixtureSource(), { targetBytes:838800, serverClosed:true });
    await openAndSubmitCashClose(alreadyClosed.page);
    await alreadyClosed.page.waitForFunction(() => window.click360GetCashCloseDiagnostics?.().stage === 'cash_close_already_confirmed_server');
    const alreadyClosedResult = await stateOutcome(alreadyClosed.page);
    assert(alreadyClosedResult.reports.length === 0, 'a server-confirmed close must not create a second local report');
    assert(alreadyClosedResult.session.status === 'open', 'a server-confirmed close must not invent local session mutations before refresh');
    assert(alreadyClosedResult.sales === 30 && alreadyClosedResult.movements === 107 && alreadyClosedResult.product0.stock === 0, 'server-confirmed recovery must not touch sale, movement, or stock');
    assert(alreadyClosedResult.preflightCalls === 1, 'server-confirmed recovery must use exactly one preflight');
    assert(alreadyClosed.pageErrors.length === 0, `unexpected already-closed page errors: ${JSON.stringify(alreadyClosed.pageErrors)}`);
    await alreadyClosed.context.close();

    const quotaFallback = await createPage(browser);
    await quotaFallback.page.evaluate(fixtureSource(), { targetBytes:838800 });
    await quotaFallback.page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (String(key).includes('CLICK360:V16:STATE')) throw new DOMException('Synthetic quota exhaustion', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
    });
    await openAndSubmitCashClose(quotaFallback.page);
    await quotaFallback.page.getByRole('heading', { name:'Resumen de Cierre' }).waitFor({ state:'visible', timeout:15000 });
    const quotaResult = await stateOutcome(quotaFallback.page);
    assert(quotaResult.reports.length === 1 && quotaResult.session.status === 'closed', 'IndexedDB fallback must safely complete the close');
    assert(quotaResult.sales === 30 && quotaResult.movements === 107 && quotaResult.product0.stock === 0, 'quota fallback must not duplicate sale, movement, or stock');
    assert(quotaFallback.pageErrors.length === 0, `unexpected quota fallback page errors: ${JSON.stringify(quotaFallback.pageErrors)}`);
    await quotaFallback.context.close();

    const offline = await createPage(browser);
    await offline.context.setOffline(true);
    await new Promise((resolve) => setTimeout(resolve, 750));
    await offline.page.evaluate(fixtureSource(), { targetBytes:838800 });
    await openAndSubmitCashClose(offline.page, { programmaticOpen:true });
    await offline.page.waitForFunction(() => [...document.querySelectorAll('h2')].some((node) => ['Resumen de Cierre', 'No pudimos cerrar la caja'].includes(node.textContent?.trim())), null, { timeout:15000 });
    const offlineResult = await stateOutcome(offline.page);
    assert(offlineResult.reports.length === 1 && offlineResult.session.status === 'closed', `offline PWA must retain exactly one pending compact close: ${JSON.stringify(offlineResult)}`);
    assert(offlineResult.preflightCalls === 0, 'offline PWA must not pretend to verify the server');
    assert(offlineResult.sales === 30 && offlineResult.movements === 107 && offlineResult.product0.stock === 0, 'offline close must not duplicate sale, movement, or stock');
    assert(offlineResult.diagnostic?.status === 'pending' && offlineResult.diagnostic?.online === false, `offline close must remain visibly pending: ${JSON.stringify(offlineResult.diagnostic)}`);
    assert(offline.pageErrors.length === 0, `unexpected offline page errors: ${JSON.stringify(offline.pageErrors)}`);
    await offline.context.setOffline(false);
    await offline.context.close();

    console.log(`PASS SHARY save_rejected WebKit/iPhone regression: rejected=${rejectedResult.diagnostic.saveFailure.payloadBytes}, compact=${result.bytes}, reports=1, stock unchanged, server preflight/retry/quota/offline covered`);
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
