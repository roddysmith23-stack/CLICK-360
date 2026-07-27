#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadSmartPrintCore } = require('./qa/helpers/smart-print-test-utils.cjs');

const ROOT = __dirname;
function loadDomain(filename, key, additions = {}) {
  const context = { console, Date, Math, Object, Array, Set, String, Number, Boolean, RegExp, Error, ...additions };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, filename), 'utf8'), context, { filename });
  return context[key];
}

const platform = loadDomain('p2-platform-domain.js', 'CLICK360_P2_PLATFORM');
const restaurant = loadDomain('p2-restaurant-domain.js', 'CLICK360_P2_RESTAURANT');
const logistics = loadDomain('p2-logistics-domain.js', 'CLICK360_P2_LOGISTICS');
const canvas = loadDomain('universal-label-canvas.js', 'CLICK360_UNIVERSAL_LABEL_CANVAS', {
  CLICK360_SMART_PRINT: loadSmartPrintCore()
});

const business = {
  id: 'biz-p2-integration',
  name: 'Negocio Sintetico P2',
  type: 'restaurante',
  settings: { modules: { workers: true, restaurant: true, logistics: true } }
};
const featureFlags = {
  workerAccessEnabled: { key: 'workerAccessEnabled', enabled: true, rolloutPercentage: 100 },
  restaurantAdvancedEnabled: { key: 'restaurantAdvancedEnabled', enabled: true, rolloutPercentage: 100 },
  logisticsEnabled: { key: 'logisticsEnabled', enabled: true, rolloutPercentage: 100 }
};
const access = { status: 'active', plan: 'pro_lifetime', billingStatus: 'lifetime', lifetime: true };
const owner = { uid: 'owner-p2', email: 'owner@example.test', businessId: business.id, roleId: 'owner', status: 'active' };

(() => {
  const ownerResolution = platform.resolveEnabledModules({ accountAccess: access, business, membership: owner, featureFlags, device: { uid: owner.uid, environment: 'local' } });
  for (const module of ['core', 'inventory', 'labels', 'workers', 'restaurant', 'logistics', 'admin']) assert.equal(ownerResolution.modules[module], true, `owner enables ${module}`);
  assert.equal(platform.can(ownerResolution, 'members.manage'), true);
  assert.equal(platform.can(ownerResolution, 'orders.create'), true);
  assert.equal(platform.can(ownerResolution, 'routes.write'), true);

  const server = { uid: 'server-p2', email: 'server@example.test', businessId: business.id, roleId: 'server', status: 'active' };
  const serverResolution = platform.resolveEnabledModules({ accountAccess: access, business, membership: server, featureFlags, device: { uid: server.uid, environment: 'local' } });
  assert.equal(serverResolution.modules.restaurant, true);
  assert.equal(serverResolution.modules.workers, false);
  assert.equal(platform.can(serverResolution, 'orders.create'), true);
  assert.equal(platform.can(serverResolution, 'members.manage'), false);
  assert.equal(platform.can(serverResolution, 'routes.write'), false);

  const revoked = { ...server, status: 'revoked' };
  const revokedResolution = platform.resolveEnabledModules({ accountAccess: access, business, membership: revoked, featureFlags, device: { uid: revoked.uid, environment: 'local' } });
  assert.deepEqual(revokedResolution.modules, { core: true, inventory: false, sales: false, cash: false, reports: false, scanner: false, labels: false, workers: false, restaurant: false, logistics: false, finance: false, admin: false });
  assert.equal(platform.can(revokedResolution, 'orders.create'), false);

  const suspendedResolution = platform.resolveEnabledModules({ accountAccess: { ...access, status: 'suspended' }, business, membership: owner, featureFlags, device: { uid: owner.uid, environment: 'local' } });
  assert.equal(suspendedResolution.readOnly, true);
  assert.equal(platform.can(suspendedResolution, 'orders.create'), false);
  assert.equal(platform.can(suspendedResolution, 'routes.write'), false);
})();

(() => {
  const server = { uid: 'server-p2', roleId: 'server' };
  let orderA = restaurant.createOrder({ id: 'order-a', businessId: business.id, tableId: 'table-a', actor: server, now: 1700000000000 });
  orderA = restaurant.addLine({ order: orderA, actor: server, line: { id: 'line-a', name: 'Plato QA', qty: 1, price: 12, area: 'kitchen' }, now: 1700000000001 });
  const orderB = restaurant.createOrder({ id: 'order-b', businessId: 'biz-other', tableId: 'table-b', actor: server, now: 1700000000002 });
  assert.throws(() => restaurant.mergeOrders({ target: orderA, source: orderB, actor: server }), /cross_business_denied/);
  const queue = restaurant.kitchenQueue([orderA, orderB], { businessId: business.id, area: 'kitchen' });
  assert.equal(queue.length, 0, 'draft orders are not exposed to the kitchen');
  orderA = restaurant.sendRound({ order: orderA, actor: server, now: 1700000000003 });
  assert.equal(restaurant.kitchenQueue([orderA, orderB], { businessId: business.id, area: 'kitchen' }).length, 1);
})();

(() => {
  const logisticsOwner = { uid: owner.uid, roleId: 'owner' };
  const vehicle = logistics.createVehicle({ input: { id: 'vehicle-p2', businessId: business.id, name: 'Unidad QA', plate: 'P2-001', capacity: 40 }, actor: logisticsOwner, now: 1700000000100 });
  const route = logistics.createRoute({ input: { id: 'route-p2', businessId: business.id, name: 'Ruta QA', date: '2026-07-27', vehicleId: vehicle.id }, vehicle, actor: logisticsOwner, now: 1700000000101 });
  assert.equal(route.businessId, business.id);
  assert.throws(() => logistics.createRoute({ input: { id: 'route-other', businessId: 'biz-other', name: 'Ruta ajena', date: '2026-07-27', vehicleId: vehicle.id }, vehicle, actor: logisticsOwner }), /cross_business_denied/);
  const assigned = logistics.assignRoute({ route, vehicle, seller: { uid: 'seller-p2', name: 'Vendedor QA' }, collector: { uid: 'collector-p2', name: 'Cobrador QA' }, actor: logisticsOwner, now: 1700000000102 });
  assert.equal(logistics.canAccessRoute(assigned, { uid: 'seller-p2', roleId: 'routeSeller' }, 'read'), true);
  assert.equal(logistics.canAccessRoute(assigned, { uid: 'seller-other', roleId: 'routeSeller' }, 'read'), false);
})();

(() => {
  const documentMm = canvas.normalizeDocument({
    schemaVersion: 2,
    paper: { id: 'paper-p2', mediaType: 'roll-2', widthMm: 40, heightMm: 60, mediaWidthMm: 82, mediaHeightMm: 60, columns: 2, rows: 1, gapXmm: 2, dpi: 203 },
    objects: [{ id: 'qr-p2', type: 'qr', xMm: 2, yMm: 2, widthMm: 16, heightMm: 16 }],
    quantity: 3,
    startSlot: 2
  });
  const groups = [{ product: { id: 'product-p2', name: 'Producto QA', code: 'P2-001', price: 10 }, copies: 3 }];
  const plan = canvas.buildPrintPlan(groups, documentMm, { startSlot: 2 });
  const zoomOnly = canvas.buildPrintPlan(groups, { ...documentMm, zoom: 3 }, { startSlot: 2 });
  assert.equal(plan.count, 3);
  assert.equal(plan.pages.length, 2);
  assert.equal(canvas.planFingerprint(plan), canvas.planFingerprint(zoomOnly), 'visual zoom cannot alter physical output');
  assert.equal(plan.pages[0].cells[0].status, 'used');
  assert.equal(plan.pages[0].cells[1].item.product.id, 'product-p2');
})();

(() => {
  const index = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const build = readFileSync(path.join(ROOT, 'scripts/build-static-release.mjs'), 'utf8');
  const worker = readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  for (const script of ['p2-platform-domain.js', 'p2-restaurant-domain.js', 'p2-logistics-domain.js', 'universal-label-canvas.js', 'universal-label-editor.js']) {
    assert.match(index, new RegExp(script.replace('.', '\\.')));
    assert.match(build, new RegExp(script.replace('.', '\\.')));
    assert.match(worker, new RegExp(script.replace('.', '\\.')));
  }
  assert.match(app, /restaurantAdvancedEnabled\(\) \?/, 'restaurant navigation remains feature gated');
  assert.match(app, /logisticsAdvancedEnabled\(\) \?/, 'logistics navigation remains feature gated');
  assert.match(app, /workerAccessEnabled:\{ key:'workerAccessEnabled', enabled:false/, 'worker access defaults off');
  assert.match(app, /restaurantAdvancedEnabled:\{ key:'restaurantAdvancedEnabled', enabled:false/, 'restaurant access defaults off');
  assert.match(app, /logisticsEnabled:\{ key:'logisticsEnabled', enabled:false/, 'logistics access defaults off');
})();

console.log('P2 universal platform integration harness: PASS');
