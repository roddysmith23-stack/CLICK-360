import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2.1 (LIVE CLIENT RECOVERY -- INCIDENTE 2, invitación de trabajador):
 * "Le envié ayer la solicitud a mi mami, pero la página le cargó hasta
 * aquí." -- el enlace real de WhatsApp/Copiar invitación (probado y
 * preservado por qa/r37-2-worker-invite-message-e2e.mjs, sin cambios)
 * genera `?invite=true&ownerId=...&inviteHash=...&inviteToken=...`, pero
 * TODO el arranque de autenticación sólo reconocía `?flow=invite` más un
 * `inviteSession` que sólo existe si ESE MISMO navegador ya lo escribió
 * antes en sessionStorage. Un navegador nuevo (cero storage, como el de
 * la mamá de SHARY) nunca puede tener eso -- el enlace, aunque
 * perfectamente válido, se ignoraba en silencio y la visitante caía en el
 * gate público genérico.
 *
 * Fix real (firebase-service.js, bootstrapInvitationFromExternalUrl(),
 * llamada en boot() antes de auth.onAuthStateChanged): reconoce el enlace
 * externo real por su forma real, valida que ownerId/inviteHash/
 * inviteToken tengan forma correcta, genera un inviteSession NUEVO y
 * local (el enlace compartible sigue sin llevarlo -- eso no cambia), lo
 * persiste en sessionStorage, y normaliza la URL interna a
 * `flow=invite&inviteSession=...` para que el resto del arranque
 * (ya correcto, ya probado, sin tocar) siga funcionando exactamente igual
 * que hoy para el formulario manual "Tengo una invitación".
 *
 * La validación REAL contra el registro del invite (hash, ownerId,
 * tenant, email de Google, status, expiración de 7 días) vive en
 * acceptInvitationFromUrl() y en firestore.rules, servidor, sin tocar --
 * este test no la re-implementa; prueba específicamente el gap que
 * SHARY reportó: el reconocimiento del enlace en un navegador nuevo,
 * ANTES de que cualquier autenticación real ocurra.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_WORKER_INVITE_BOOTSTRAP_E2E_PORT || 4753);
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

    // ── Owner: generate a REAL invite through the real, unmodified UI
    // (same offline harness pattern as qa/r37-2-worker-invite-message-
    // e2e.mjs) and capture the EXACT URL the production code produces --
    // never hand-construct or normalize it ourselves. ──
    const ownerContext = await browser.newContext();
    await ownerContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const ownerErrors = [];
    ownerPage.on('pageerror', (e) => ownerErrors.push(e.message));
    await ownerPage.goto(url, { waitUntil: 'networkidle' });
    await ownerPage.waitForFunction(() => typeof window.click360SetTenantContext === 'function', { timeout: 15000 });
    await ownerPage.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const ownerUid = 'test-r37-2-1-invite-owner-uid';
    await ownerPage.evaluate(async (uid) => {
      document.getElementById('click360-auth-gate')?.remove();
      window.click360ClearTenantContext = () => {};
      window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
      Object.defineProperty(window, 'click360User', {
        configurable: true,
        get() { return this.__u; },
        set(value) { if (value != null) this.__u = value; }
      });
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'owner@example.com', role: 'owner', name: 'Industrias Omega', photoURL: '', status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };
      window.click360CurrentOwnerWorkersEnabled = async () => true;
      window.click360InviteWorkerEmail = async (email, name, options) => ({ inviteHash: 'a'.repeat(64), inviteToken: 'b'.repeat(64), permissions: options.permissions || {} });
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
    }, ownerUid);
    await ownerPage.waitForSelector('#workerName', { state: 'visible', timeout: 15000 });
    await ownerPage.fill('#workerName', 'Mamá de SHARY');
    await ownerPage.fill('#workerEmail', 'mama.shary@example.com');
    await ownerPage.selectOption('#workerRole', 'cajero');
    await ownerPage.click('#addWorkerForm button[type="submit"]');
    await ownerPage.waitForFunction(() => document.getElementById('inviteLinkBox')?.style.display === 'block', { timeout: 15000 });
    const realInviteUrl = await ownerPage.$eval('#inviteLinkVal', (el) => el.value);
    assert(realInviteUrl.includes('invite=true'), `sanity: the real generated URL must use the real invite=true shape, got: ${realInviteUrl}`);
    assert(!realInviteUrl.includes('flow=invite') && !realInviteUrl.includes('inviteSession'), `the shareable link itself must NEVER embed flow/inviteSession -- those must always be generated fresh, locally, per device. Got: ${realInviteUrl}`);
    if (ownerErrors.length) throw new Error(`Owner-side errors: ${JSON.stringify(ownerErrors)}`);
    await ownerContext.close();

    // ── Fresh browser, zero storage -- exactly like a family member
    // opening the WhatsApp link on their own phone for the first time. ──
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const freshErrors = [];
    freshPage.on('pageerror', (e) => freshErrors.push(e.message));
    await freshPage.goto(realInviteUrl, { waitUntil: 'networkidle' });
    await freshPage.waitForFunction(() => typeof window.click360GetPublicAuthDiagnostics === 'function', { timeout: 15000 });

    const diagnostics = await freshPage.evaluate(() => window.click360GetPublicAuthDiagnostics());
    assert(diagnostics.intent === 'invite', `a fresh browser opening the REAL invite URL must be recognized as an invite intent, got intent="${diagnostics.intent}" -- this is the exact bug SHARY's mother hit ("la página le cargó hasta aquí")`);
    assert(diagnostics.explicitInvitationIntent === true, `the explicit invitation intent must be marked true on a fresh browser, got ${diagnostics.explicitInvitationIntent}`);

    const bootstrapState = await freshPage.evaluate(() => {
      const stored = sessionStorage.getItem('CLICK360:V16_2:EXPLICIT_INVITATION');
      return { stored: stored ? JSON.parse(stored) : null, hash: location.hash, search: location.search };
    });
    assert(bootstrapState.stored, 'a fresh invite-session record must be written to sessionStorage automatically, without any user action');
    assert(!realInviteUrl.includes(bootstrapState.stored.sessionId), `the locally-generated inviteSession must be a NEW id, never embedded in the original shareable link, got sessionId="${bootstrapState.stored.sessionId}"`);
    assert(bootstrapState.search.includes('flow=invite') && bootstrapState.search.includes('inviteSession='), `the URL must be normalized in place to the canonical flow=invite&inviteSession=... shape the rest of the app already understands, got: ${bootstrapState.search}`);

    if (freshErrors.length) throw new Error(`Unexpected page errors on the fresh browser: ${JSON.stringify(freshErrors)}`);
    await freshContext.close();

    // ── Fail-closed: a malformed URL (garbage token/hash, not 64-hex)
    // must NEVER be treated as a valid invite bootstrap. ──
    const badContext = await browser.newContext();
    const badPage = await badContext.newPage();
    await badPage.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    await badPage.goto(`${url}?invite=true&ownerId=${ownerUid}&inviteHash=not-a-real-hash&inviteToken=also-not-real`, { waitUntil: 'networkidle' });
    await badPage.waitForFunction(() => typeof window.click360GetPublicAuthDiagnostics === 'function', { timeout: 15000 });
    const badDiagnostics = await badPage.evaluate(() => window.click360GetPublicAuthDiagnostics());
    assert(badDiagnostics.explicitInvitationIntent === false, `a malformed invite URL (non-hex token/hash) must NEVER be bootstrapped as a valid invitation, got explicitInvitationIntent=${badDiagnostics.explicitInvitationIntent}`);
    await badContext.close();

    console.log('CLICK 360 r37.2.1 worker-invite external-bootstrap E2E PASS: el enlace real generado por el UI de Trabajadores (sin modificar), abierto en un navegador COMPLETAMENTE nuevo, es reconocido como invitación real (antes caía en el gate público genérico); el inviteSession se genera nuevo y local (nunca viaja en el enlace compartible); una URL con token/hash con forma inválida NUNCA se bootstrapea.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
