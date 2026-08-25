import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (LOGISTICS WORKER PERMISSION CLOSURE -- E2E completo): Owner crea
 * invitación como "Vendedor de ruta" -> el mensaje de WhatsApp/copiar
 * invitación trae el cargo humano real -> el trabajador queda activo ->
 * Owner lo asigna a UNA ruta real (Ruta Norte) mediante el picker real de
 * #routeForm (ya no texto libre) -> el trabajador entra a #logistics y ve
 * SOLO su ruta asignada -- Ruta Sur (donde no está asignado) permanece
 * invisible, igual que la creación/gestión de vehículos.
 *
 * Harness notes: reuses the exact offline synthetic-session pattern
 * proven across every other r37.2 test this session (network block,
 * auth-gate removal, click360WriteGate/SyncNow overrides, the
 * window.click360User property-pin auth-race defense). Identity is
 * switched mid-test (Owner -> Worker) by re-applying the SAME captured
 * tenant state under a different window.click360User, exactly the
 * technique qa/r37-2-logistics-e2e.mjs's role-permission sweep already
 * uses.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LOGISTICS_ASSIGNMENT_E2E_PORT || 4752);
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

function baseTenantState(overrides = {}) {
  return {
    businesses: [{ id: 'biz_main', name: 'Distribuidora QA Norte-Sur', status: 'activo', type: 'logistica', settings: {} }],
    activeBusinessId: 'biz_main',
    products: [{ id: 'prod_a', businessId: 'biz_main', code: 'A-001', name: 'Producto A', qty: 30, stock: 30, price: 10 }],
    sales: [], movements: [], cashSessions: [],
    dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
    tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
    restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
    legalAcceptances: [], finance: {}, logistics: {},
    settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} }, workers: [] },
    updatedAtMs: Date.now(), updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function setupSession(page, { uid, role, isOwner, tenantState }) {
  await page.evaluate(({ uid, role, isOwner, tenantState }) => {
    document.getElementById('click360-auth-gate')?.remove();
    window.click360ClearTenantContext = () => {};
    window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
    window.click360SyncNow = async () => true;
    window.click360GetWorkerAccessRequestStatus = async () => ({ status: 'approved' });
    Object.defineProperty(window, 'click360User', {
      configurable: true,
      get() { return this.__u; },
      set(value) { if (value != null) this.__u = value; }
    });
    const context = { authUid: uid, ownerUid: 'owner-of-biz', ownerId: 'owner-of-biz', businessId: 'owner-of-biz', tenantKey: 'owner:owner-of-biz:business:owner-of-biz', schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = {
      uid, email: `${uid}@example.com`, role: isOwner ? 'owner' : (role || 'worker'), name: isOwner ? 'Dueña QA' : 'Trabajador QA', photoURL: '',
      status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: 'owner-of-biz', isOwner: isOwner === true, source: 'accountAccess',
      permissions: tenantState.__workerPermissions || undefined
    };
    const domain = window.CLICK360_V16_DOMAIN;
    window.click360ApplyTenantState({
      ...tenantState,
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: domain?.TERMS_VERSION, privacyVersion: domain?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }]
    }, context);
  }, { uid, role, isOwner, tenantState });
  // r37.2: switching window.click360User/tenant context TWICE within one
  // real page (Owner -> Worker) is a synthetic test-only technique real
  // users never hit (a real browser tab boots with exactly ONE identity,
  // established through several awaited steps before any navigation) --
  // this harness's single-tick identity swap can observe a can()/
  // checkAuth() read one macrotask before something else settles. Poll
  // click360Route() itself rather than trust a single call, exactly the
  // deterministic-wait pattern already proven for this session's other
  // real (non-flaky-by-design) harness timing hazards.
  await page.waitForFunction(() => {
    window.click360Route('logistics');
    return location.hash === '#logistics';
  }, { timeout: 15000, polling: 100 }).catch(() => {});
  await page.waitForFunction(() => !!location.hash && location.hash !== '#', { timeout: 15000 });
}

async function getState(page) {
  return page.evaluate(() => window.click360GetTenantState?.() || {});
}

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
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function' && typeof window.CLICK360_P2_LOGISTICS === 'object', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });

    const ownerUid = 'test-r37-2-logistics-owner';
    const vendedorUid = 'test-r37-2-logistics-vendedor-norte';

    // ── Owner: crea la invitación real como "Vendedor de ruta" y verifica
    // que el mensaje de WhatsApp trae el cargo humano real. ──
    await setupSession(page, { uid: ownerUid, isOwner: true, tenantState: baseTenantState() });
    await page.evaluate((vendedorUid) => {
      window.click360CurrentOwnerWorkersEnabled = async () => true;
      window.click360InviteWorkerEmail = async (email, name, options) => ({ inviteHash: 'test-hash-logistics', inviteToken: 'test-token-logistics', permissions: options.permissions || {} });
      window.click360Route('workers');
    }, vendedorUid);
    await page.waitForSelector('#workerRole', { timeout: 15000 });
    await page.selectOption('#workerRole', 'vendedor_ruta');
    await page.fill('#workerName', 'Vendedor Norte');
    await page.fill('#workerEmail', 'vendedor.norte@example.com');
    await page.click('#addWorkerForm button[type="submit"]');
    // Generous timeout: this is the last test in the full qa:labels:e2e
    // chain (dozens of sequential Chromium launches before it), where real
    // system load can occasionally push this past 15s even though the
    // underlying wait is deterministic (proven stable standalone).
    await page.waitForFunction(() => document.getElementById('inviteLinkBox')?.style.display === 'block', { timeout: 30000 });
    await page.click('#copyInviteTextBtn');
    const invitationMessage = await page.evaluate(() => navigator.clipboard.readText());
    assert(invitationMessage.includes('Vendedor de ruta'), `the invitation message must carry the real human displayRole "Vendedor de ruta", got: ${invitationMessage}`);

    // ── Simular que el trabajador ya fue aprobado (el flujo de aceptación
    // multi-sesión real ya está cubierto por qa/r37-worker-invite-flow-
    // harness.cjs) -- activamos el registro con su uid real y permisos de
    // logística reales, exactamente lo que devolvería click360ListWorkers()
    // tras la aprobación. ──
    const afterInvite = await getState(page);
    const invitedWorker = afterInvite.settings.workers.find((w) => w.email === 'vendedor.norte@example.com');
    assert(invitedWorker, 'the invited worker must be present in state.settings.workers');
    const vendedorPermissions = invitedWorker.permissions;
    assert(vendedorPermissions?.logistics?.['routeSales.create'] === true, 'the Vendedor de ruta preset must grant routeSales.create');
    assert(vendedorPermissions?.logistics?.['collections.write'] !== true, 'the Vendedor de ruta preset must NOT grant collections.write by default');
    invitedWorker.uid = vendedorUid;
    invitedWorker.status = 'active';

    // ── Owner: crea DOS rutas reales por el picker real (ya no texto
    // libre) y asigna al Vendedor SOLO a "Ruta Norte". ──
    await page.evaluate((state) => {
      const context = { authUid: 'test-r37-2-logistics-owner', ownerUid: 'owner-of-biz', ownerId: 'owner-of-biz', businessId: 'owner-of-biz', tenantKey: 'owner:owner-of-biz:business:owner-of-biz', schemaVersion: 10 };
      window.click360ApplyTenantState(state, context);
      window.click360Route('logistics');
    }, afterInvite);
    await page.waitForSelector('#newRouteBtn', { timeout: 15000 });
    await page.click('#newRouteBtn');
    await page.waitForSelector('#routeForm', { timeout: 10000 });
    await page.fill('#routeName', 'Ruta Norte');
    await page.selectOption('#routeSeller', { label: 'Vendedor Norte' });
    await page.click('#routeForm button[type="submit"]');
    await page.waitForFunction(() => window.click360GetTenantState().logistics.routes.some((r) => r.name === 'Ruta Norte'), { timeout: 10000 });

    await page.click('#newRouteBtn');
    await page.waitForSelector('#routeForm', { timeout: 10000 });
    await page.fill('#routeName', 'Ruta Sur');
    await page.click('#routeForm button[type="submit"]');
    await page.waitForFunction(() => window.click360GetTenantState().logistics.routes.some((r) => r.name === 'Ruta Sur'), { timeout: 10000 });

    const afterRoutes = await getState(page);
    const rutaNorte = afterRoutes.logistics.routes.find((r) => r.name === 'Ruta Norte');
    const rutaSur = afterRoutes.logistics.routes.find((r) => r.name === 'Ruta Sur');
    assert(rutaNorte.sellerId === vendedorUid, `Ruta Norte must be assigned to the real Vendedor uid via the real picker, got sellerId="${rutaNorte.sellerId}"`);
    assert(!rutaSur.sellerId, 'Ruta Sur must remain unassigned (the picker must never default-assign)');

    // ── Cambio de identidad: el Vendedor entra a #logistics con la MISMA
    // data que el Owner acaba de crear. ──
    await setupSession(page, {
      uid: vendedorUid, role: 'seller', isOwner: false,
      tenantState: { ...afterRoutes, __workerPermissions: vendedorPermissions }
    });
    assert((await page.evaluate(() => location.hash)) === '#logistics', 'the Vendedor de ruta must actually reach #logistics (can() must grant the logistics section for a worker holding a real logistics permission)');

    const routeListText = await page.locator('.logisticsList').first().locator('..').innerText();
    const allRouteCards = await page.locator('[data-route-open]').allInnerTexts();
    assert(allRouteCards.some((text) => text.includes('Ruta Norte')), `the Vendedor must see their OWN assigned route (Ruta Norte) in the list, got: ${JSON.stringify(allRouteCards)}`);
    assert(!allRouteCards.some((text) => text.includes('Ruta Sur')), `the Vendedor must NEVER see Ruta Sur (not their assignment) in the route list -- fail-closed route list, got: ${JSON.stringify(allRouteCards)}`);
    assert(!(await page.locator('#newVehicleBtn').count()), 'a Vendedor de ruta must never see the vehicle-management button');
    assert(!(await page.locator('#newRouteBtn').count()), 'a Vendedor de ruta must never see the route-creation button');

    // Open their own route -- the sale form must be reachable.
    await page.click('[data-route-open]');
    await page.waitForSelector('.modal', { timeout: 10000 });
    assert(await page.locator('#routeSaleForm').count() === 0, 'sanity: the sale form only appears once the route is dispatched -- not present on a freshly-created planned route');
    const assignmentText = await page.locator('text=Asignación').locator('..').innerText();
    assert(assignmentText.includes('Vendedor Norte'), `the workspace must show the real assigned Vendedor's name, got: ${assignmentText}`);

    // ── UX: no jerga técnica visible al trabajador, y sin overflow
    // horizontal en 390 (móvil) ni 1440 (escritorio) para su vista
    // restringida real. ──
    const bodyTextWithWorkspaceOpen = await page.evaluate(() => document.body.innerText);
    for (const technicalTerm of ['routeSales.create', 'routeSales.discount', 'collections.write', 'loadSheets.write', 'settlements.approve', 'routeseller']) {
      assert(!bodyTextWithWorkspaceOpen.includes(technicalTerm), `the Vendedor-facing UI must never show the raw technical permission key "${technicalTerm}" -- only human labels`);
    }
    // A real re-navigation (not a hand-cleared DOM patch, which can leave
    // stale overlay remnants) is the reliable way to get back to a clean
    // #logistics render -- there is no exposed window.click360CloseModal.
    await page.evaluate(() => window.click360Route('logistics'));
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert(overflow.scrollWidth <= overflow.clientWidth + 4, `the Vendedor's #logistics list must not overflow horizontally at ${width}px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`);
    }
    await page.click('[data-route-open]');
    await page.waitForSelector('.modal', { timeout: 10000 });
    const workspaceOverflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    assert(workspaceOverflow.scrollWidth <= workspaceOverflow.clientWidth + 4, `the Vendedor's own-route workspace modal must not overflow horizontally at 1440px (scrollWidth=${workspaceOverflow.scrollWidth}, clientWidth=${workspaceOverflow.clientWidth})`);

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);
    console.log('CLICK 360 r37.2 logistics worker-assignment E2E PASS: Owner invita como "Vendedor de ruta" (WhatsApp trae el cargo humano real), asigna al trabajador a UNA ruta real mediante el picker real (no texto libre), y el trabajador -- cambiando de identidad con la MISMA data -- entra a #logistics y ve únicamente su ruta asignada; Ruta Sur y la gestión de vehículos permanecen completamente invisibles; sin jerga técnica visible y sin overflow horizontal en 390/1440.');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

await run();
