import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

/**
 * r37-2 (mission section 30, "NO FALSE STATES").
 *
 * homeView()/cashView() were already fixed under r36 P0-2 (see
 * qa/r36-p0-2-reliability-e2e.mjs) to never compute money totals / day-
 * started status off `state` before tenantDataHydrated is true. This sweep
 * proves the SAME discipline for every other view function that reads
 * counts/lists/status off `state`: a tenant with real data in each domain
 * must never see a false "no hay X" / 0 / module-disabled negative on a
 * render that races ahead of the real Firestore pull -- it must see the
 * same neutral "Sincronizando" loading card homeView()/cashView() use,
 * and only the real data once hydration completes.
 *
 * Covers: inventory, sell, reports, debtors, activity, crm, reminders,
 * tables, kitchen, bar, logistics (deny-before-hydration only), finance,
 * invoices, printing.
 */
const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_R37_2_FALSE_STATES_E2E_PORT || 4733);
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

    const uid = 'test-r37-2-false-states-uid';
    const result = await page.evaluate((uid) => {
      const context = { authUid: uid, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}`, schemaVersion: 10 };
      window.click360SetTenantContext(context, { deferLocalLoad: true });
      window.click360User = { uid, email: 'test@example.com', role: 'owner', name: 'Test', photoURL: '', status: 'founder_legacy', approved: true, businessLimit: 10, workerLimit: 25, ownerId: uid, isOwner: true, source: 'accountAccess' };

      const routes = ['inventory', 'sell', 'reports', 'debtors', 'activity', 'crm', 'reminders', 'tables', 'kitchen', 'bar', 'logistics', 'finance', 'invoices', 'printing'];
      const before = {};
      routes.forEach((r) => {
        window.click360Route(r);
        before[r] = document.getElementById('app').innerHTML;
      });

      const day = window.click360LocalDateKey();
      const realData = {
        businesses: [{ id: 'biz_main', name: 'Restaurante Real', status: 'activo', type: 'restaurante', settings: {} }],
        activeBusinessId: 'biz_main',
        products: [
          { id: 'p1', businessId: 'biz_main', code: 'P1', name: 'Producto Real Uno', qty: 10, stock: 10, price: 5 },
          { id: 'p2', businessId: 'biz_main', code: 'P2', name: 'Producto Real Dos', qty: 4, stock: 4, price: 12 }
        ],
        sales: [
          { id: 's1', businessId: 'biz_main', date: day, status: 'completado', total: 25, received: 25, balance: 0, method: 'Efectivo', items: [{ name: 'Producto Real Uno', qty: 2, price: 5 }], cashSessionId: 'cs1', when: 'Hoy', createdBy: 'Test' },
          { id: 's2', businessId: 'biz_main', date: day, status: 'layaway', total: 60, received: 20, balance: 40, method: 'Apartado', items: [{ name: 'Producto Real Dos', qty: 1, price: 60 }], cashSessionId: 'cs1', when: 'Hoy', createdBy: 'Test', customer: 'Cliente Real Apartado', customerPhone: '593999999999' }
        ],
        movements: [{ id: 'm1', businessId: 'biz_main', date: day, kind: 'apertura', amount: 20, cashSessionId: 'cs1', createdAtMs: Date.now() }],
        cashSessions: [{ id: 'cs1', businessId: 'biz_main', date: day, status: 'open', openedBy: 'Test' }],
        dailyReports: [], deletedProducts: [],
        auditLogs: [{ id: 'a1', businessId: 'biz_main', action: 'sale_created', createdBy: 'Test', createdAt: new Date().toISOString(), when: 'Hoy', details: { total: 25 } }],
        layaways: [{ id: 'lay1', saleId: 's2', businessId: 'biz_main', status: 'active', total: 60, paid: 20, balance: 40, payments: [], customerSnapshot: { name: 'Cliente Real Apartado', phone: '593999999999' }, itemsSnapshot: [{ name: 'Producto Real Dos', qty: 1 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
        invoices: [{ id: 'inv1', businessId: 'biz_main', provider: 'Proveedor Real SA', number: 'F-001', date: day, amount: 33, status: 'active', createdBy: 'Test' }],
        tables: [{ id: 't1', businessId: 'biz_main', name: 'Mesa Real Uno', seats: 4, partySize: 2, status: 'free', createdAt: new Date().toISOString() }],
        tableOrders: [{ id: 'to1', businessId: 'biz_main', tableId: 't1', status: 'open', openedAtMs: Date.now(), sentToKitchen: true, kitchenStatus: 'preparing', items: [{ id: 'p1', productId: 'p1', name: 'Plato Real de Cocina', qty: 1, price: 5, area: 'kitchen' }, { id: 'p2', productId: 'p2', name: 'Trago Real de Barra', qty: 1, price: 12, area: 'bar' }] }],
        restaurantPayments: [], restaurantPrintHistory: [], restaurantEvents: [], restaurantRecipes: [], labelPrintHistory: [], notifications: [],
        legalAcceptances: [{ id: 'legal1', businessId: 'biz_main', uid, termsVersion: window.CLICK360_V16_DOMAIN?.TERMS_VERSION, privacyVersion: window.CLICK360_V16_DOMAIN?.PRIVACY_VERSION, acceptedAt: new Date().toISOString(), source: 'onboarding' }],
        finance: { payments: [{ id: 'fin1', businessId: 'biz_main', name: 'Pago Real Arriendo', category: 'Arriendo', amount: 150, status: 'pending', createdAt: new Date().toISOString() }], loans: [], envelopes: [], goals: [] },
        settings: { customers: [{ id: 'cust1', businessId: 'biz_main', name: 'Cliente Real CRM', phone: '593988888888', notes: '', updatedAt: new Date().toISOString() }], reminders: [{ id: 'rem1', businessId: 'biz_main', type: 'task', title: 'Recordatorio Real Pendiente', dueAt: new Date(Date.now() + 86400000).toISOString(), status: 'pending', done: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], labelTemplates: [], labelProfiles: [], userProfiles: {}, onboarding: {}, activationRequests: [], policies: {}, legal: {} },
        logistics: { vehicles: [], routes: [], loadSheets: [], routeSales: [], collections: [], returns: [], routeSettlements: [], routeExpenses: [], routeCustomers: [], events: [], printHistory: [] },
        updatedAtMs: Date.now(), updatedAt: new Date().toISOString()
      };
      window.click360ApplyTenantState(realData, context);

      const after = {};
      routes.forEach((r) => {
        window.click360Route(r);
        after[r] = document.getElementById('app').innerHTML;
      });

      return { before, after, isHydratedAfter: window.click360IsTenantDataHydrated() };
    }, uid);

    const SYNCING = 'Sincronizando';
    const falseNegatives = {
      inventory: ['Aún no hay'],
      sell: ['Jornada no Iniciada', 'Caja Cerrada'],
      reports: ['Sin ventas'],
      debtors: ['Aún no hay apartados'],
      activity: ['Aún no hay actividad'],
      crm: ['Todavia no hay clientes'],
      reminders: ['No hay recordatorios pendientes'],
      tables: ['Activa este módulo', 'Crea Mesa 1'],
      kitchen: ['Activa Restaurante', 'No hay pedidos pendientes'],
      bar: ['Activa Restaurante', 'No hay pedidos pendientes'],
      logistics: ['Disponible al configurar'],
      finance: ['Sin registros'],
      invoices: ['No se encontraron facturas'],
      printing: ['Aún no hay ventas', 'Agrega un producto primero']
    };

    Object.entries(falseNegatives).forEach(([route, phrases]) => {
      assert(result.before[route].includes(SYNCING), `${route}View() must show the syncing card before real data is ever applied, not a guessed empty/denied state`);
      phrases.forEach((phrase) => {
        assert(!result.before[route].includes(phrase), `${route}View() must NOT show "${phrase}" while state is still the empty seed -- this is a false negative, not a neutral loading state`);
      });
    });

    assert(result.isHydratedAfter, 'tenantDataHydrated must flip true after click360ApplyTenantState is called with a real snapshot');

    const realDataChecks = {
      inventory: 'Producto Real Uno',
      reports: 'Producto Real Uno' /* top-selling list uses item name */,
      debtors: 'Cliente Real Apartado',
      activity: 'registró una venta',
      crm: 'Cliente Real CRM',
      reminders: 'Recordatorio Real Pendiente',
      tables: 'Mesa Real Uno',
      kitchen: 'Plato Real de Cocina',
      bar: 'Trago Real de Barra',
      finance: 'Pago Real Arriendo',
      invoices: 'Proveedor Real SA'
    };
    Object.entries(realDataChecks).forEach(([route, phrase]) => {
      assert(!result.after[route].includes(SYNCING), `${route}View() must show the real screen (not the syncing card) once real data has been applied`);
      assert(result.after[route].includes(phrase), `${route}View() must show real data ("${phrase}") once hydration completes`);
    });

    // sell: real data has an already-open cash session -- the real sell
    // form must render, not the pre-existing "Jornada no Iniciada" gate
    // (this is the exact SHARY-style false state the r36 P0-2 fix removed
    // from cashView()/homeView(); sellView() had the same latent bug).
    assert(!result.after.sell.includes(SYNCING), 'sellView() must show the real screen once real data has been applied');
    assert(!result.after.sell.includes('Jornada no Iniciada'), 'sellView() must recognize the real open cash session once hydrated, not still guess the day never started');
    assert(result.after.sell.includes('sellSearch'), 'sellView() must render the real sell form once hydrated');

    // printing: quick actions must reflect real sales/products, not the
    // disabled "sin ventas / agrega un producto" placeholders.
    assert(!result.after.printing.includes(SYNCING), 'printingView() must show the real screen once real data has been applied');
    assert(!result.after.printing.includes('Aún no hay ventas'), 'printingView() must recognize the real sale once hydrated');

    if (pageErrors.length) throw new Error(`Unexpected page errors: ${JSON.stringify(pageErrors)}`);

    console.log('CLICK 360 r37-2 false-states sweep E2E PASS: inventory/sell/reports/debtors/activity/crm/reminders/tables/kitchen/bar/logistics/finance/invoices/printing all show the neutral syncing card (never a guessed empty/denied/zero negative) before hydration, and their real data once hydration completes');
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
