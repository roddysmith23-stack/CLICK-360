import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37.2 (Section 17, "LOGISTICA E2E"): qa-p2-logistics-routes-settlement-
 * harness.cjs and qa-logistics-dispatch-settlement-harness.cjs already
 * prove the CLICK360_P2_LOGISTICS domain module (p2-logistics-domain.js)
 * is correct in isolation, and that app.js's dispatch/settlement handlers
 * call into it (string-matching on the source, not a live DOM). Neither
 * drives the actual UI in a browser. This test does: it loads the real
 * index.html, drives the real logisticsView()/openRouteWorkspace() forms
 * and buttons in app.js (~line 4589 onward) through Playwright, and proves
 * the full live chain vehiculo -> ruta -> hoja de carga -> despacho ->
 * venta -> retorno -> liquidación -> aprobación -> cierre -> reapertura
 * end to end against the REAL save()/commitCriticalMutation() write path.
 *
 * Harness notes (offline-safe synthetic session, no real Firebase sign-in
 * -- see qa/r37-worker-access-gate-e2e.mjs and
 * qa/r37-2-worker-invite-message-e2e.mjs for the same pattern this reuses
 * verbatim):
 *  - All outbound network is blocked except the local static server, so
 *    the real Firebase Auth SDK never resolves a background "user=null"
 *    that would otherwise wipe #app or trigger a real page reload.
 *  - window.click360WriteGate is overridden to report allowed:true -- this
 *    is the CLIENT-SIDE "still verifying session" UX gate only; real
 *    enforcement is firestore.rules, server-side, untouched.
 *  - window.click360SyncNow is overridden to resolve true and
 *    window.click360RefreshNow confirms the unchanged synthetic snapshot -- dispatch and
 *    settlement-close go through the real commitCriticalMutation() (real
 *    save() -> real localStorage/IndexedDB persistence, real optimistic
 *    state mutation, real rollback-on-failure logic); only the final
 *    "confirm this in the real Firestore cloud" round trip is stubbed,
 *    since that requires real credentials out of scope for this harness.
 *
 * What this proves that the structural harnesses cannot:
 *  1. Dispatching a route through the real #routeDispatchBtn decrements
 *     real state.products stock EXACTLY ONCE, and settling+closing the
 *     route (which restores SELLABLE returns) does not touch stock a
 *     second time for the same units -- no double stock discount across
 *     dispatch+settlement, verified against the real product record in
 *     the real app state, not a domain-module-only calculation.
 *  2. A closed settlement that gets reopened (owner-only, reason
 *     required) is AUDITED, not silently mutated: the real
 *     #settlementReopenBtn click leaves a real audit trail entry
 *     (state.auditLogs, via the real addAudit()) AND the domain
 *     settlement's own append-only auditTrail carries the reopen event
 *     and reason, and re-closing after the reopen does not re-restore the
 *     same sellable-return stock a second time.
 *  3. Role permissions: using the EXACT same fixture that lets an owner
 *     reach a real, clickable "Aprobar" button, a real
 *     window.click360Route('logistics') call for every non-owner role the
 *     domain module's own rolePermissions() catalog names (inventory,
 *     routeSeller, collector) plus cashier/supervisor never reaches
 *     #logistics at all -- app.js's can() route guard (the FIRST gate
 *     renderApp() applies, ahead of the logistics domain's own granular
 *     vehicles.read/loadSheets.write/settlements.approve permissions) has
 *     no 'logistics' entry for any non-owner role, so it silently
 *     redirects to #home before the domain-level permission catalog is
 *     ever consulted. This proves "only the right role can approve/settle"
 *     holds today (only an owner can), but also surfaces that it holds by
 *     accident of a missing route-guard entry, not by the granular
 *     per-action role system p2-logistics-domain.js was built to enforce
 *     -- see the written findings for the exact fix.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LOGISTICS_E2E_PORT || 4750);
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
    businesses: [{ id: 'biz_main', name: 'Distribuidora QA', status: 'activo', type: 'logistica', settings: {} }],
    activeBusinessId: 'biz_main',
    products: [
      { id: 'prod_a', businessId: 'biz_main', code: 'A-001', name: 'Producto A', qty: 30, stock: 30, price: 10 },
      { id: 'prod_b', businessId: 'biz_main', code: 'B-001', name: 'Producto B', qty: 20, stock: 20, price: 5 }
    ],
    sales: [], movements: [], cashSessions: [],
    dailyReports: [], deletedProducts: [], auditLogs: [], layaways: [], invoices: [],
    tables: [], tableOrders: [], restaurantPayments: [], restaurantPrintHistory: [],
    restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
    legalAcceptances: [], finance: {}, logistics: {},
    settings: { onboarding: { completedAt: new Date().toISOString(), operationId: 'x', version: 16.2, checklist: {} } },
    updatedAtMs: Date.now(), updatedAt: new Date().toISOString(),
    ...overrides
  };
}

async function setupSession(page, { uid, role, isOwner, logistics = {} }) {
  await page.evaluate(({ uid, role, isOwner, logistics, tenantState }) => {
    document.getElementById('click360-auth-gate')?.remove();
    window.click360ClearTenantContext = () => {};
    window.click360WriteGate = () => ({ allowed: true, reason: 'ok' });
    window.click360SyncNow = async () => true;
    // Critical commerce mutations now require an authoritative readback in
    // addition to a successful push. This fully local harness has no cloud,
    // so model that successful readback explicitly while retaining the real
    // remoteApplied predicate against the current tenant state.
    window.click360RefreshNow = async () => true;
    // A non-owner worker session is otherwise fail-closed by the (correct, separately-tested -- see
    // qa/r37-worker-access-gate-e2e.mjs) worker access gate, which defaults to blocking until a real
    // Firestore-backed access-request status resolves. This harness has no real Firestore, so report the
    // worker as already-approved through the one exposed integration seam, exactly as
    // qa/r37-2-worker-invite-message-e2e.mjs stubs window.click360InviteWorkerEmail -- this is required just
    // to REACH the logistics screen as a worker at all; it does not touch the logistics permission checks
    // themselves (those still run for real, see the role-permission scenario below).
    window.click360GetWorkerAccessRequestStatus = async () => ({ status: 'approved' });
    const context = { authUid: uid, ownerUid: 'owner-of-biz', ownerId: 'owner-of-biz', businessId: 'owner-of-biz', tenantKey: 'owner:owner-of-biz:business:owner-of-biz', schemaVersion: 10 };
    window.click360SetTenantContext(context, { deferLocalLoad: true });
    window.click360User = {
      uid, email: `${role}@example.com`, role, name: role === 'owner' ? 'Dueño QA' : 'Trabajador QA', photoURL: '',
      status: 'active', approved: true, businessLimit: 10, workerLimit: 25, ownerId: 'owner-of-biz', isOwner: isOwner === true, source: 'accountAccess'
    };
    const domain = window.CLICK360_V16_DOMAIN;
    const termsVersion = domain?.TERMS_VERSION;
    const privacyVersion = domain?.PRIVACY_VERSION || termsVersion;
    window.click360ApplyTenantState({
      ...tenantState, logistics,
      legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion, privacyVersion, acceptedAt: new Date().toISOString(), source: 'onboarding' }]
    }, context);
    window.click360Route('logistics');
  }, { uid, role, isOwner, logistics, tenantState: baseTenantState() });
  // Owners always land on #logistics; a non-owner may be redirected elsewhere (see the role-permission
  // scenario below, which asserts on the resulting hash itself) -- either way, wait for SOME real route to
  // have settled (never an empty/unset hash) before the caller inspects the resulting DOM/hash.
  await page.waitForFunction(() => !!location.hash && location.hash !== '#', { timeout: 15000 });
}

async function waitVisible(page, selector, timeoutMs = 15000) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.offsetParent !== null;
  }, selector, { timeout: timeoutMs });
}

async function getState(page) {
  return page.evaluate(() => window.click360GetTenantState?.() || {});
}

async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
      return route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.click360SetTenantContext === 'function' && typeof window.click360Route === 'function' && typeof window.CLICK360_P2_LOGISTICS === 'object', { timeout: 15000 });
    await page.addStyleTag({ content: '#click360-auth-gate{display:none!important;pointer-events:none!important;} #app{pointer-events:auto!important;filter:none!important;opacity:1!important;}' });
    // This test drives MANY more real sequential DOM interactions than the other qa/r37*-e2e.mjs harnesses
    // (a full vehiculo->...->reapertura chain plus a 5-role permission sweep), so it runs long enough for a
    // real hazard the other tests are mostly too fast to hit: the real (never-really-signed-in) Firebase Auth
    // SDK's own onAuthStateChanged fires in the background with user=null, and firebase-service.js's
    // deactivateActiveAccount() sets window.click360User = null DIRECTLY (firebase-service.js ~line 3538) --
    // independent of window.click360ClearTenantContext, which this harness already no-ops. Left unguarded,
    // under real system load this can race ahead of a real owner session mid-test and silently downgrade
    // every subsequent authUser()/isOwnerUser() check to a non-owner, corrupting the very role-permission
    // assertions this test exists to make. Since there is no exposed seam for the SDK listener itself, guard
    // the one concrete symptom directly: make window.click360User immune to being reset to null/undefined,
    // while leaving every real assignment this test's own setupSession() makes completely unaffected.
    await page.evaluate(() => {
      let currentValue = window.click360User;
      Object.defineProperty(window, 'click360User', {
        configurable: true,
        enumerable: true,
        get() { return currentValue; },
        set(next) { if (next !== null && next !== undefined) currentValue = next; }
      });
    });

    // ── 1. OWNER: full live chain, real DOM, real write path ──
    const ownerUid = 'test-r37-2-logistics-owner-uid';
    await setupSession(page, { uid: ownerUid, role: 'owner', isOwner: true });

    // vehiculo
    await page.click('#newVehicleBtn');
    await waitVisible(page, '#vehicleForm');
    await page.fill('#vehiclePlate', 'gqa-001');
    await page.fill('#vehicleName', 'Camión QA');
    await page.click('#vehicleForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.logisticsRow').length >= 1, { timeout: 10000 });

    // ruta
    await page.click('#newRouteBtn');
    await waitVisible(page, '#routeForm');
    await page.fill('#routeName', 'Ruta QA Norte');
    await page.fill('#routeZone', 'Zona QA');
    await page.selectOption('#routeVehicle', { index: 1 });
    await page.click('#routeForm button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-route-open]').length >= 1, { timeout: 10000 });

    // open route workspace
    await page.click('[data-route-open]');
    await waitVisible(page, '#routeLoadForm');

    // hoja de carga: load 5 x Producto A
    await page.selectOption('#routeLoadProduct', { label: 'Producto A · 30 disp.' });
    await page.fill('#routeLoadQty', '5');
    await page.click('#routeLoadForm button[type="submit"]');
    await waitVisible(page, '#routeDispatchBtn');

    const stockBeforeDispatch = await page.evaluate(() => window.click360GetTenantState().products.find((p) => p.id === 'prod_a').qty);
    assert(stockBeforeDispatch === 30, `loading onto the load sheet must NOT touch stock yet (still available for in-store sale until dispatch), got ${stockBeforeDispatch}`);

    // despacho: real commitCriticalMutation path
    await page.click('#routeDispatchBtn');
    await page.waitForFunction(() => {
      const route = (window.click360GetTenantState().logistics.routes || [])[0];
      return route && route.status === 'dispatched';
    }, { timeout: 15000 });

    let snap = await getState(page);
    const routeId = snap.logistics.routes[0].id;
    assert(snap.logistics.loadSheets[0].status === 'dispatched', 'the real load sheet must reach status=dispatched after the real dispatch click');
    assert(snap.logistics.loadSheets[0].stockCommittedAt, 'the real load sheet must record stockCommittedAt (idempotency guard)');
    const stockAfterDispatch = snap.products.find((p) => p.id === 'prod_a').qty;
    assert(stockAfterDispatch === 25, `dispatch must decrement the REAL product record by exactly the loaded qty (30 - 5 = 25), got ${stockAfterDispatch}`);

    // re-open the workspace: dispatch section must show "already dispatched", never a second load form for this sheet
    await waitVisible(page, '#routePrintBtn');

    // venta de ruta
    await page.selectOption('#routeSaleProduct', { label: 'Producto A · 25 disp.' });
    await page.fill('#routeSaleQty', '2');
    await page.selectOption('#routePaymentType', 'cash');
    await page.click('#routeSaleForm button[type="submit"]');
    await page.waitForFunction((rid) => (window.click360GetTenantState().logistics.routeSales || []).some((s) => s.routeId === rid), routeId, { timeout: 10000 });

    snap = await getState(page);
    assert(snap.logistics.routeSales.length === 1, 'the real route sale must be persisted to the real state');
    assert(snap.products.find((p) => p.id === 'prod_a').qty === 25, 'a route sale (selling ALREADY-DISPATCHED route stock) must NOT touch the shop product record again -- it only consumes the load sheet allotment, not a second stock decrement');
    const saleTotal = snap.logistics.routeSales[0].total;
    assert(saleTotal === 20, `route sale of 2 x Producto A (price 10) must total 20, got ${saleTotal}`);

    // retorno vendible (sellable) de 1 unidad -- the sale submit above already closed and re-opened the
    // workspace modal (see routeSaleForm's handler), so it is already showing here, no re-click needed.
    await waitVisible(page, '#routeReturnForm');
    await page.selectOption('#routeReturnProduct', { label: 'Producto A · 25 disp.' });
    await page.fill('#routeReturnQty', '1');
    await page.selectOption('#routeReturnCondition', 'sellable');
    await page.click('#routeReturnForm button[type="submit"]');
    await page.waitForFunction((rid) => (window.click360GetTenantState().logistics.returns || []).some((r) => r.routeId === rid), routeId, { timeout: 10000 });

    snap = await getState(page);
    assert(snap.logistics.returns.length === 1, 'the real sellable return must be persisted');
    assert(snap.products.find((p) => p.id === 'prod_a').qty === 25, 'a return record itself must NOT touch stock yet -- sellable stock is only restored when the settlement is approved AND closed (avoids double-counting while the route is still open)');

    // liquidación: enviar a aprobación -- the return submit's own handler already re-opened the workspace.
    await waitVisible(page, '#routeSettlementForm');
    // expected cash = cash sales (20) + collections (0) - expenses (0) = 20
    await page.fill('#routeReceivedCash', '20');
    await page.click('#routeSettlementForm button[type="submit"]');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'pending_approval';
    }, routeId, { timeout: 10000 });

    snap = await getState(page);
    let settlement = snap.logistics.routeSettlements[0];
    assert(settlement.status === 'pending_approval', 'a submitted settlement must be pending_approval, never auto-closed by a single click');
    assert(settlement.calculation.expectedCash === 20, `expected cash must equal cash sales (20) with no collections/expenses, got ${settlement.calculation.expectedCash}`);
    assert(settlement.difference === 0, 'received cash (20) matching expected cash (20) must yield a zero difference');

    // aprobar -- the settlement submit's own handler already re-opened the workspace.
    await waitVisible(page, '#settlementApproveBtn');
    await page.click('#settlementApproveBtn');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'approved';
    }, routeId, { timeout: 10000 });

    // cerrar: real commitCriticalMutation path, restores the 1 sellable return unit. The approve click's own
    // handler already re-opened the workspace, so #settlementCloseBtn is already visible here.
    const stockBeforeClose = (await getState(page)).products.find((p) => p.id === 'prod_a').qty;
    assert(stockBeforeClose === 25, 'stock must still be 25 right up until the settlement is actually closed');
    await waitVisible(page, '#settlementCloseBtn');
    await page.click('#settlementCloseBtn');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'closed';
    }, routeId, { timeout: 15000 });

    snap = await getState(page);
    settlement = snap.logistics.routeSettlements.find((s) => s.routeId === routeId);
    const route = snap.logistics.routes.find((r) => r.id === routeId);
    assert(settlement.status === 'closed' && route.status === 'closed', 'closing a settlement must close both the settlement and the route');
    const stockAfterClose = snap.products.find((p) => p.id === 'prod_a').qty;
    assert(stockAfterClose === 26, `closing must restore EXACTLY the 1 sellable-return unit once (25 + 1 = 26), got ${stockAfterClose}. dispatch decremented 5 once; the sale consumed 2 of the loaded 5 (no shop-stock effect); only the 1 sellable return is added back -- NO double stock discount across dispatch+settlement.`);

    // ── 2. Reopen must be AUDITED, not a silent mutation, and re-closing must not double-restore stock ──
    await page.click('[data-route-open]');
    await waitVisible(page, '#settlementReopenBtn');
    const auditCountBeforeReopen = (await getState(page)).auditLogs.length;
    page.once('dialog', (dialog) => dialog.accept('Conteo QA: corrección de diferencia'));
    await page.click('#settlementReopenBtn');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'reopened';
    }, routeId, { timeout: 10000 });

    snap = await getState(page);
    settlement = snap.logistics.routeSettlements.find((s) => s.routeId === routeId);
    assert(settlement.status === 'reopened', 'the real reopen click must move the real settlement to status=reopened');
    assert(settlement.reopenReason === 'Conteo QA: corrección de diferencia', 'the real reopen reason must be persisted on the real settlement record');
    assert(snap.logistics.routes.find((r) => r.id === routeId).status === 'settlement_pending', 'reopening must move the route back to settlement_pending, not leave it silently closed');
    assert(snap.auditLogs.length > auditCountBeforeReopen, 'reopening a closed settlement must append a NEW real audit log entry (state.auditLogs), never silently mutate the record with no trace');
    const reopenAudit = snap.auditLogs[snap.auditLogs.length - 1];
    assert(reopenAudit.action === 'logistics_settlement_reopened', `the new audit entry must be typed logistics_settlement_reopened, got ${reopenAudit.action}`);
    assert(reopenAudit.details?.reason === 'Conteo QA: corrección de diferencia', 'the app-level audit entry must carry the real reopen reason in its details');
    const domainAuditTrail = settlement.auditTrail || [];
    assert(domainAuditTrail.some((entry) => entry.type === 'route_settlement_reopened' && entry.details?.reason === 'Conteo QA: corrección de diferencia'), 'the domain-level settlement.auditTrail (append-only, never overwritten) must ALSO carry the reopen event with its reason -- the previous approved/closed history must remain intact alongside it');
    assert(domainAuditTrail.some((entry) => entry.type === 'route_settlement_created'), 'reopening must never erase the ORIGINAL settlement history (route_settlement_created) -- it is superseded/appended to, not replaced');
    assert(settlement.closedAt, 'reopening must preserve the original closedAt timestamp as history, not delete it, since the audit trail must show the record WAS closed before being reopened');

    // approve + close again after reopen -- must NOT double-restore the same sellable-return stock. The
    // reopen click's own handler already re-opened the workspace (settlementApproveBtn is present again
    // since a reopened settlement routes through the same pending-approval-style UI).
    await waitVisible(page, '#settlementApproveBtn');
    await page.click('#settlementApproveBtn');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'approved';
    }, routeId, { timeout: 10000 });
    // the approve click's own handler re-opened the workspace again.
    await waitVisible(page, '#settlementCloseBtn');
    await page.click('#settlementCloseBtn');
    await page.waitForFunction((rid) => {
      const s = (window.click360GetTenantState().logistics.routeSettlements || []).find((entry) => entry.routeId === rid);
      return s && s.status === 'closed';
    }, routeId, { timeout: 15000 });

    snap = await getState(page);
    const stockAfterReclose = snap.products.find((p) => p.id === 'prod_a').qty;
    assert(stockAfterReclose === 26, `re-closing after an approved reopen must NEVER restore the same sellable-return unit a second time (must stay at 26, not 27), got ${stockAfterReclose}`);

    // ── 3. Role permissions: only the right role (owner) can even REACH dispatch/approve/close ──
    // Fixture: a route that is already dispatched with a pending_approval settlement -- i.e. exactly the
    // state where, if a non-owner COULD reach it, they might try to click "Aprobar"/"Cerrar".
    const roleFixtureLogistics = {
      vehicles: [], routes: [{ id: 'route_role', businessId: 'biz_main', name: 'Ruta QA Permisos', zone: 'Zona QA', date: new Date().toISOString().slice(0, 10), status: 'settlement_pending', auditTrail: [] }],
      loadSheets: [{ id: 'sheet_role', businessId: 'biz_main', routeId: 'route_role', status: 'dispatched', dispatchedAt: new Date().toISOString(), stockCommittedAt: new Date().toISOString(), items: [{ id: 'li2', productId: 'prod_b', code: 'B-001', name: 'Producto B', qty: 2, price: 5, total: 10 }], auditTrail: [] }],
      routeSales: [], collections: [], returns: [],
      routeSettlements: [{ id: 'settle_role', businessId: 'biz_main', routeId: 'route_role', loadSheetId: 'sheet_role', status: 'pending_approval', receivedCash: 0, difference: 0, calculation: { expectedCash: 0, routeId: 'route_role', loadSheetId: 'sheet_role', salesTotal: 0, cashSales: 0, creditSales: 0, collectionsTotal: 0, expensesTotal: 0, sellableReturnValue: 0, damagedReturnValue: 0, shortageValue: 0, overageValue: 0, openCredit: 0, saleCount: 0, returnCount: 0 }, createdAt: new Date().toISOString(), createdAtMs: Date.now(), updatedAt: new Date().toISOString(), updatedAtMs: Date.now(), auditTrail: [] }],
      routeExpenses: [], routeCustomers: [], events: [], printHistory: []
    };

    // Sanity check first: the SAME fixture, as owner, must actually reach the real workspace with a real,
    // clickable "Aprobar" button -- proving the redirect asserted below is a genuine role gate, not a broken
    // fixture that would have redirected everyone.
    await setupSession(page, { uid: ownerUid, role: 'owner', isOwner: true, logistics: roleFixtureLogistics });
    assert((await page.evaluate(() => location.hash)) === '#logistics', 'sanity: an owner must land on #logistics with this fixture');
    await page.click('[data-route-open]');
    await waitVisible(page, '#settlementApproveBtn');

    // Try every non-owner role the domain module's own rolePermissions() catalog (p2-logistics-domain.js)
    // names -- inventory (bodega), routeSeller, collector, admin-as-worker, and a generic cashier -- against
    // the EXACT same fixture and the real click360Route('logistics') call a worker's UI uses.
    for (const workerRole of ['inventory', 'routeSeller', 'collector', 'cashier', 'supervisor']) {
      const workerUid = `test-r37-2-logistics-worker-${workerRole}`;
      await setupSession(page, { uid: workerUid, role: workerRole, isOwner: false, logistics: roleFixtureLogistics });
      const hashForRole = await page.evaluate(() => location.hash);
      assert(hashForRole !== '#logistics', `a non-owner with role="${workerRole}" must NEVER reach the real #logistics screen at all (app.js can(), which gates window.click360Route('logistics'), has no route-permission entry for 'logistics' for ANY non-owner role) -- got hash=${hashForRole}. This means dispatch/approve/close (and even read-only routes/loadSheets access) are unreachable in the live UI for every non-owner, regardless of the granular vehicles.read/routes.read/loadSheets.write/collections.write/settlements.approve role catalog p2-logistics-domain.js:9-34 defines for exactly these roles (inventory, routeSeller, collector).`);
    }

    // The real product stock and the real pending settlement must be byte-for-byte untouched by any of the
    // above blocked navigation attempts.
    const afterRoleAttempts = await getState(page);
    assert(afterRoleAttempts.logistics.routeSettlements.find((s) => s.id === 'settle_role')?.status === 'pending_approval', 'a settlement must remain pending_approval after non-owners were blocked from reaching it -- no partial/silent state mutation from the blocked navigation attempts');
    assert(afterRoleAttempts.products.find((p) => p.id === 'prod_b').qty === 20, 'Producto B stock must remain untouched (20) after the blocked non-owner navigation attempts');

    if (pageErrors.length) throw new Error(`Unexpected real page errors during the logistics E2E: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37.2 logistics E2E PASS: real vehiculo->ruta->hoja de carga->despacho->venta->retorno->liquidacion->aprobacion->cierre->reapertura chain driven through the real DOM; dispatch decrements real product stock exactly once and settlement-close restores only the sellable-return units exactly once (no double stock discount, verified across a reopen+reclose cycle too); reopening a closed settlement is real-audited (state.auditLogs + the settlement\'s own append-only auditTrail) rather than silently mutated; and every non-owner role tried (inventory, routeSeller, collector, cashier, supervisor) is blocked from ever reaching #logistics at all against the exact fixture an owner reaches a real "Aprobar" button with, leaving product stock and the pending settlement byte-for-byte unchanged.');
  } catch (error) {
    if (process.env.CLICK360_LOGISTICS_E2E_DEBUG) {
      try {
        const pages = browser.contexts().flatMap((c) => c.pages());
        for (const p of pages) {
          console.error('---modalRoot---', await p.evaluate(() => document.getElementById('modalRoot')?.innerHTML?.slice(0, 3000)).catch(() => 'n/a'));
          console.error('---hash---', await p.evaluate(() => location.hash).catch(() => 'n/a'));
          console.error('---toast---', await p.evaluate(() => document.getElementById('toast')?.textContent).catch(() => 'n/a'));
        }
      } catch {}
    }
    throw error;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

try {
  await waitForServer();
  await run();
} finally {
  server.kill('SIGTERM');
}
