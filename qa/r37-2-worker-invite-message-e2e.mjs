import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (real Owner evidence, tonight): the Owner generated a worker
 * invitation and copied it for WhatsApp, but only got the bare link -- no
 * business name, no role, no explanation. This drives the REAL app.js
 * "Registrar Trabajador" form end to end (real DOM, real button wiring,
 * real clipboard) and proves:
 *  1. "Copiar invitación" copies a FULL message: business name + role +
 *     the link + what happens next -- never just the URL.
 *  2. "Copiar enlace" copies ONLY the URL (still available, still useful,
 *     but clearly a different, clearly-labeled action).
 *  3. The WhatsApp button prefills the SAME full message a comerciante
 *     would want, not the bare link.
 *  4. Business name and role are genuinely dynamic (not hardcoded), and
 *     labels read exactly "Copiar invitación" / "Copiar enlace".
 *
 * Harness notes (offline synthetic session, no real Firebase sign-in):
 *  - Real outbound network requests are blocked so the real Firebase Auth
 *    SDK never resolves a background "user=null" a few seconds in, which
 *    would otherwise call click360ClearTenantContext() and wipe #app --
 *    or worse, if the real #click360-auth-gate overlay gets recreated
 *    mid-test and a click lands on its own hidden <form>, trigger a real
 *    native form submit (a genuine page reload to a malformed URL).
 *  - firebase-service.js's real save() write-gate checks a private
 *    AUTH_APPROVED flag that only becomes true after a real sign-in round
 *    trip; window.click360WriteGate is its one exposed seam, so this test
 *    overrides it to report allowed:true -- this is a CLIENT-SIDE UX gate
 *    only (real enforcement is firestore.rules, server-side, untouched).
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_WORKER_INVITE_MSG_E2E_PORT || 4741);
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
    await waitForServer();
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
    // See harness notes above.
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const uid = 'test-r37-2-invite-owner-uid';
    await page.evaluate(async (uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Owner', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      window.click360CurrentOwnerWorkersEnabled = async () => true;
      window.click360InviteWorkerEmail = async (email, name, options) => ({ inviteHash: 'test-hash-123', inviteToken: 'test-token-456', permissions: options.permissions || {} });
      window.click360ApplyTenantState({
        businesses: [{ id: 'biz_main', name: 'Industrias Omega', status: 'activo', type: 'ropa', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [], sales: [], movements: [], cashSessions: [],
        dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
        tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
        restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: {}, logistics: {},
        settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} }, workers: [] },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      }, context);
      window.click360Route('workers');
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 15000;
        const check = () => {
          const el = document.getElementById('workerName');
          if (el && el.offsetParent !== null) return resolve();
          if (Date.now() > deadline) return reject(new Error(`Timed out waiting for #workerName to become visible (hash=${location.hash})`));
          setTimeout(check, 100);
        };
        check();
      });
    }, uid);

    await page.fill('#workerName', 'Juan Pérez');
    await page.fill('#workerEmail', 'juan@gmail.com');
    await page.selectOption('#workerRole', 'cajero');
    await page.click('#addWorkerForm button[type="submit"]');
    await page.waitForFunction(() => document.getElementById('inviteLinkBox')?.style.display === 'block', { timeout: 15000 });

    const inviteLink = await page.$eval('#inviteLinkVal', (el) => el.value);
    assert(inviteLink.includes('inviteHash=test-hash-123') && inviteLink.includes('inviteToken=test-token-456'), `the raw link field must contain the real invite hash/token, got ${inviteLink}`);

    // ── Copiar enlace: ONLY the URL ──
    const copyLinkLabel = await page.$eval('#copyInviteLinkBtn', (el) => el.textContent.trim());
    assert(copyLinkLabel === 'Copiar enlace', `the URL-only copy button must be labeled exactly "Copiar enlace", got "${copyLinkLabel}"`);
    await page.click('#copyInviteLinkBtn');
    const copiedLink = await page.evaluate(() => navigator.clipboard.readText());
    assert(copiedLink === inviteLink, `"Copiar enlace" must copy ONLY the raw URL, got: ${copiedLink}`);
    assert(!copiedLink.includes('Industrias Omega') && !copiedLink.includes('Cajero'), '"Copiar enlace" must never include business name/role text -- URL only');

    // ── Copiar invitación: the FULL message ──
    const copyTextLabel = await page.$eval('#copyInviteTextBtn', (el) => el.textContent.trim());
    assert(copyTextLabel === 'Copiar invitación', `the full-message copy button must be labeled exactly "Copiar invitación", got "${copyTextLabel}"`);
    await page.click('#copyInviteTextBtn');
    const copiedMessage = await page.evaluate(() => navigator.clipboard.readText());
    assert(copiedMessage.includes('Industrias Omega'), `"Copiar invitación" must include the real business name, got: ${copiedMessage}`);
    assert(copiedMessage.includes('Cajero'), `"Copiar invitación" must include the real role label, got: ${copiedMessage}`);
    assert(copiedMessage.includes(inviteLink), `"Copiar invitación" must embed the real invite link, got: ${copiedMessage}`);
    assert(copiedMessage.includes('Ingresa al siguiente enlace'), `"Copiar invitación" must explain what to do with the link, not just paste a bare URL, got: ${copiedMessage}`);
    assert(copiedMessage.length > inviteLink.length + 40, '"Copiar invitación" must be substantially more than just the link');

    // ── Enviar por WhatsApp: the SAME full message, not the bare link ──
    const whatsappHref = await page.$eval('#whatsappInviteLinkBtn', (el) => el.getAttribute('href'));
    const whatsappText = decodeURIComponent(whatsappHref.split('text=')[1] || '');
    assert(whatsappText.includes('Industrias Omega') && whatsappText.includes('Cajero') && whatsappText.includes(inviteLink), `the real Owner-reported bug: WhatsApp must prefill business+role+link, not just the bare link. Got: ${whatsappText}`);
    assert(whatsappText === copiedMessage, 'the WhatsApp message and "Copiar invitación" must be the exact SAME text -- one real invitation message, not two different drafts');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 worker-invite-message E2E PASS: "Copiar enlace" copies ONLY the URL, "Copiar invitación" and "Enviar por WhatsApp" both carry the SAME full message (real business name + real role + link + explanation) -- the exact real Owner-reported gap is closed.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
