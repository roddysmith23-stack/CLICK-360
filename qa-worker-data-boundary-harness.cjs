const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('worker-data-boundary.js', 'utf8');
const buildScript = fs.readFileSync('scripts/build-static-release.mjs', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const migrationRunner = fs.readFileSync('scripts/worker-boundary-migrate.mjs', 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'worker-data-boundary.js' });
const api = context.globalThis.CLICK360_WORKER_DATA_BOUNDARY;

assert(api, 'worker data boundary API must be published');
assert(buildScript.includes("'worker-data-boundary.js'"), 'static release must include the worker boundary runtime');
assert(serviceWorker.includes("'./worker-data-boundary.js'"), 'PWA cache must include the worker boundary runtime');
assert(index.indexOf('worker-data-boundary.js') < index.indexOf('firebase-service.js'), 'worker boundary must load before Firebase service');
assert(migrationRunner.includes("projectId === PRODUCTION_PROJECT") && migrationRunner.includes('Production is forbidden'), 'migration runner must reject production');
assert(migrationRunner.includes("writePolicy:'create_only'") && migrationRunner.includes("status:'CUTOVER_VERIFIED'") && migrationRunner.includes("status:'ROLLBACK_ONLY'"), 'migration phases must be progressive and reversible');
assert(!migrationRunner.includes("collection('state').doc('main').set") && !migrationRunner.includes('source.ref.set('), 'migration runner must never overwrite state/main');
assert.deepStrictEqual([...api.MODULES], [
  'members', 'products', 'sales', 'layaways', 'cashSessions', 'movements', 'auditEvents', 'settings'
]);
assert.throws(() => api.assertNonProductionProject('click-360'), /producci/i);
assert.strictEqual(api.assertNonProductionProject('click360-staging-7620168025'), 'click360-staging-7620168025');

const seller = api.normalizePermissionMap('vendedor');
assert.strictEqual(api.can(seller, 'sales', 'create'), true);
assert.strictEqual(api.can(seller, 'products', 'update'), false);
assert.strictEqual(api.can(seller, 'layaways', 'payment'), true);
const cashier = api.normalizePermissionMap('cajero');
assert.strictEqual(api.can(cashier, 'cashSessions', 'close'), true);
const inventory = api.normalizePermissionMap('inventario');
assert.strictEqual(api.can(inventory, 'products', 'delete'), true);
assert.strictEqual(api.can(inventory, 'sales', 'create'), false);
const supervisor = api.normalizePermissionMap('supervisor');
assert.strictEqual(api.can(supervisor, 'auditEvents', 'read'), true);
const admin = api.normalizePermissionMap('admin');
assert.strictEqual(api.can(admin, 'settings', 'manage'), true);

const legacy = {
  revision: 12,
  activeBusinessId: 'biz-a',
  businesses: [
    { id: 'biz-a', name: 'Negocio A', settings: { tax: { enabled: true, rate: 15 } } },
    { id: 'biz-b', name: 'Negocio B' }
  ],
  products: [
    { id: 'p-a', businessId: 'biz-a', name: 'Producto A', stock: 7 },
    { id: 'p-b', businessId: 'biz-b', name: 'Producto B', stock: 99 }
  ],
  sales: [{ id: 's-a', businessId: 'biz-a', subtotal: 10, total: 10, received: 10, items: [{ productId: 'p-a', qty: 1, price: 10, total: 10 }] }],
  layaways: [{ id: 'l-a', businessId: 'biz-a', total: 20, balance: 5 }],
  cashSessions: [{ id: 'cash-a', businessId: 'biz-a', openingAmount: 25 }],
  movements: [{ id: 'm-a', businessId: 'biz-a', amount: 10 }],
  auditLogs: [{ id: 'audit-a', businessId: 'biz-a', action: 'sale_created' }],
  settings: {
    legacyDataBusinessId: 'biz-a',
    customers: [{ id: 'customer-a', name: 'QA' }],
    reminders: [{ id: 'reminder-b', businessId: 'biz-b' }],
    labelTemplates: [{ id: 'template-a', businessId: 'biz-a' }],
    labelProfiles: [], policies: { returns: 'QA' }
  }
};
const member = { id: 'worker-a', uid: 'worker-a', role: 'cashier', permissions: cashier, status: 'active' };
const options = {
  ownerUid: 'owner-a', businessId: 'biz-a', members: [member], sourceRevision: 12,
  sourceHash: 'source-sha256', generatedAt: '2026-08-18T00:00:00.000Z'
};
const first = api.planMigration(legacy, options);
const second = api.planMigration(legacy, options);
assert.strictEqual(api.canonicalJson(first), api.canonicalJson(second), 'migration plan must be idempotent');
assert.strictEqual(first.manifest.sourcePath, 'businesses/owner-a/state/main');
assert.strictEqual(first.manifest.rollbackPath, 'businesses/owner-a/state/main');
assert.strictEqual(first.manifest.writePolicy, 'create_only');
assert.strictEqual(first.manifest.status, 'PREPARED');
assert.strictEqual(first.collections.products.length, 1, 'business A receives only its product');
assert.strictEqual(first.collections.products[0].id, 'p-a');
assert.strictEqual(first.collections.products[0].tenantKey, 'owner:owner-a:business:biz-a');
assert.strictEqual(first.collections.settings[0].customers.length, 1, 'legacy unscoped customer follows explicit fallback');
assert.strictEqual(first.collections.settings[0].reminders.length, 0, 'business B reminder cannot cross boundary');
assert.strictEqual(first.manifest.totals.salesTotal, 10);
assert.strictEqual(first.manifest.totals.stock, 7);
assert.strictEqual(api.validateMigrationPlan(first).valid, true);
assert.strictEqual(api.compareMigrationPlans(first, second).equal, true);

const tampered = structuredClone(first);
tampered.collections.products[0].stock = 700;
assert.strictEqual(api.compareMigrationPlans(first, tampered).equal, false, 'tampered stock must fail equivalence');
const duplicate = structuredClone(first);
duplicate.collections.products.push(structuredClone(duplicate.collections.products[0]));
duplicate.manifest.counts.products = 2;
assert(api.validateMigrationPlan(duplicate).errors.some((entry) => entry.includes('duplicate')), 'duplicate IDs must fail validation');

console.log('PASS worker data boundary: role matrix, tenant split, idempotent migration, rollback manifest, counts and totals');
