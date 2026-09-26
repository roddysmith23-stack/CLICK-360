import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_SHARY_CASH_E2E_PORT || 4741);
const url = `http://127.0.0.1:${port}/index.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Synthetic CLICK 360 server did not start.');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.clock.pauseAt(new Date('2026-09-26T02:30:00.000Z'));
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && !!window.CLICK360_CASH_RECONCILIATION, { timeout:15000 });

    const rendered = await page.evaluate(() => {
      const uid = 'synthetic-shary-owner';
      const businessId = 'synthetic-shary-business';
      const context = { authUid:uid, ownerUid:uid, ownerId:uid, businessId:uid, tenantKey:`owner:${uid}:business:${uid}`, schemaVersion:10 };
      window.click360SetTenantContext(context, { deferLocalLoad:true });
      window.click360User = { uid, email:'synthetic-owner@example.test', role:'owner', name:'Synthetic Owner', status:'founder_legacy', approved:true, ownerId:uid, isOwner:true, source:'accountAccess' };
      window.click360AccessState = { mode:'founder', plan:'founder_legacy', readOnly:false, source:'synthetic-e2e' };
      window.click360WriteGate = () => ({ allowed:true, reason:'synthetic_e2e' });
      window.click360ApplyTenantState({
        businesses:[{ id:businessId, name:'SHARY Synthetic', status:'activo', type:'ropa', lastCashBalance:0, settings:{ timeZone:'America/Guayaquil' } }],
        activeBusinessId:businessId,
        products:[
          { id:'product-a', businessId, code:'SYN-A', name:'Synthetic A', stock:4, qty:4, price:10 },
          { id:'product-b', businessId, code:'SYN-B', name:'Synthetic B', stock:2, qty:2, price:38 }
        ],
        sales:[{ id:'sale-48', operationId:'sale-op-48', businessId, date:'2026-09-02', status:'paid', total:48, method:'Transferencia', cashSessionId:'cash-with-sale', items:[{ productId:'product-a', qty:1, price:10 }, { productId:'product-b', qty:1, price:38 }] }],
        movements:[
          { id:'open-first', operationId:'open-first', businessId, date:'2026-09-02', kind:'apertura', amount:0, cashSessionId:'cash-orphan-first' },
          { id:'sale-movement', operationId:'sale-op-48', businessId, date:'2026-09-02', kind:'ingreso', amount:48, cashSessionId:'cash-with-sale' },
          { id:'open-second', operationId:'open-second', businessId, date:'2026-09-02', kind:'apertura', amount:0, cashSessionId:'cash-orphan-second' }
        ],
        // Deliberately out of order: the reconciler must use openedAt, not array position.
        cashSessions:[
          { id:'cash-orphan-second', businessId, date:'2026-09-02', status:'open', openedAt:'2026-09-26T00:54:50.534Z' },
          { id:'cash-with-sale', businessId, date:'2026-09-02', status:'closed', openedAt:'2026-09-25T23:50:50.490Z', closedAt:'2026-09-25T23:51:53.244Z', reportId:'report-reopened' },
          { id:'cash-orphan-first', businessId, date:'2026-09-02', status:'open', openedAt:'2026-09-25T23:50:24.321Z' }
        ],
        dailyReports:[
          { id:'report-reopened', businessId, date:'2026-09-02', status:'reopened', cashSessionId:'cash-with-sale', saleIds:['sale-48'], paymentTotals:{ transfer:48 } },
          { id:'report-closed-other', businessId, date:'2026-09-02', status:'closed', cashSessionId:'cash-other-closed', saleIds:[] }
        ],
        deletedProducts:[], auditLogs:[], layaways:[], invoices:[], tables:[], tableOrders:[], restaurantPayments:[], restaurantPrintHistory:[],
        restaurantEvents:[], restaurantRecipes:[], labelPrintHistory:[], notifications:[], finance:{}, settings:{}, logistics:{},
        legalAcceptances:[{ id:'legal-synthetic', businessId, uid, termsVersion:window.CLICK360_V16_DOMAIN.TERMS_VERSION, privacyVersion:window.CLICK360_V16_DOMAIN.PRIVACY_VERSION, acceptedAt:new Date().toISOString(), source:'onboarding' }],
        updatedAtMs:Date.now(), updatedAt:new Date().toISOString()
      }, context);
      window.click360Route('cash');
      document.getElementById('click360-auth-gate')?.remove();
      const button = document.getElementById('closeStaleCashBtn');
      if (!button) throw new Error('The exact unresolved synthetic cash session was not rendered.');
      const renderedCash = document.getElementById('app')?.innerHTML || '';
      button.click();
      const closeForm = document.getElementById('closeDayForm');
      if (!closeForm) throw new Error('The exact unresolved synthetic cash session did not open its close form.');
      return {
        cashHtml:renderedCash,
        modalText:document.querySelector('#modalRoot .modal')?.innerText || ''
      };
    });

    assert(rendered.cashHtml.includes('Caja del 2026-09-02 sin cerrar'), 'the unresolved exact session must be visible despite a different closed report on the date');
    assert(rendered.modalText.includes('Cerrar caja del 2026-09-02'), 'the old exact session must open the close form instead of showing "Esa caja ya está cerrada"');
    assert(!rendered.modalText.includes('Esa caja ya está cerrada'), 'date-level closed status must not block a different open session');
    await mkdir(path.join(root, 'output/playwright'), { recursive:true });
    await page.screenshot({ path:path.join(root, 'output/playwright/shary-cash-session-reconciliation.png'), fullPage:true });

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('PASS SHARY P0 browser E2E: a closed report on 2026-09-02 no longer blocks the exact unresolved session close dialog');
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
