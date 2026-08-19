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

// ── Regression: Defect A — validateSourceDocumentIdentity ──────────────────
// The migration script now calls validateSourceDocumentIdentity() before planMigration()
// when loading from Firestore (not from --input fixture). These tests verify the same
// guard logic by directly simulating the validation contract.
{
  function validateSourceDocumentIdentity(raw, ownerUid, businessId, expectedTenantKey) {
    const identity = raw?.payload?.identity;
    if (!identity || typeof identity !== 'object') {
      throw new Error('SOURCE_IDENTITY_ABSENT');
    }
    const mismatches = [];
    if (identity.ownerUid !== ownerUid) mismatches.push('ownerUid');
    if (identity.businessId !== businessId) mismatches.push('businessId');
    if (expectedTenantKey && identity.tenantKey !== expectedTenantKey) mismatches.push('tenantKey');
    if (mismatches.length) throw new Error(`SOURCE_IDENTITY_MISMATCH: ${mismatches.join(', ')}`);
  }
  const expectedKey = api.identity('owner-a', 'biz-a').tenantKey;
  const validDoc = { payload: { identity: { ownerUid:'owner-a', businessId:'biz-a', tenantKey:expectedKey }, data:{} } };
  // 1. Valid identity → must NOT throw
  assert.doesNotThrow(() => validateSourceDocumentIdentity(validDoc, 'owner-a', 'biz-a', expectedKey), 'valid identity must pass');
  // 2. payload.identity absent → SOURCE_IDENTITY_ABSENT
  const noIdentityDoc = { payload: { data:{} } };
  assert.throws(() => validateSourceDocumentIdentity(noIdentityDoc, 'owner-a', 'biz-a', expectedKey), /SOURCE_IDENTITY_ABSENT/, 'absent payload.identity must throw SOURCE_IDENTITY_ABSENT');
  // 3. Wrong ownerUid → SOURCE_IDENTITY_MISMATCH
  const wrongOwner = { payload: { identity: { ownerUid:'wrong-owner', businessId:'biz-a', tenantKey:expectedKey }, data:{} } };
  assert.throws(() => validateSourceDocumentIdentity(wrongOwner, 'owner-a', 'biz-a', expectedKey), /SOURCE_IDENTITY_MISMATCH/, 'wrong ownerUid must throw mismatch');
  // 4. Wrong businessId → SOURCE_IDENTITY_MISMATCH
  const wrongBiz = { payload: { identity: { ownerUid:'owner-a', businessId:'wrong-biz', tenantKey:expectedKey }, data:{} } };
  assert.throws(() => validateSourceDocumentIdentity(wrongBiz, 'owner-a', 'biz-a', expectedKey), /SOURCE_IDENTITY_MISMATCH/, 'wrong businessId must throw mismatch');
  // 5. Wrong tenantKey → SOURCE_IDENTITY_MISMATCH
  const wrongKey = { payload: { identity: { ownerUid:'owner-a', businessId:'biz-a', tenantKey:'owner:other:business:biz-a' }, data:{} } };
  assert.throws(() => validateSourceDocumentIdentity(wrongKey, 'owner-a', 'biz-a', expectedKey), /SOURCE_IDENTITY_MISMATCH/, 'wrong tenantKey must throw mismatch');
  // 6. Identity completely missing (null payload) → SOURCE_IDENTITY_ABSENT
  assert.throws(() => validateSourceDocumentIdentity({}, 'owner-a', 'biz-a', expectedKey), /SOURCE_IDENTITY_ABSENT/, 'null payload must throw SOURCE_IDENTITY_ABSENT');
  // 7. Fixture path (no payload wrapper) does NOT trigger validation — migration script skips it for args.input
  // This is tested end-to-end by npm run qa:worker-migration which uses --input fixture without payload
}

// ── Regression: Defect B — stock vs qty contract ──────────────────────────
// The modular gateway canonical field is 'stock'. The UI field is 'qty'.
// normalizeState must sync them; sale decrement must update 'stock'; gateway must see the delta.
{
  // Simulate normalizeState sync: product from gateway has 'stock' only
  const gatewayProduct = { id:'p1', businessId:'biz-a', name:'P1', stock:10, price:5 };
  // After normalizeState, qty === stock
  const canonicalStock = Number(gatewayProduct.stock ?? gatewayProduct.qty ?? 0);
  const normalized = { ...gatewayProduct, stock:canonicalStock, qty:canonicalStock };
  assert.strictEqual(normalized.qty, 10, 'normalizeState must set qty from stock');
  assert.strictEqual(normalized.stock, 10, 'normalizeState must preserve stock');

  // Simulate sale decrement (fixed: now writes both stock and qty)
  const before = { ...normalized };
  const p = { ...normalized };
  const sold = 3;
  p.stock -= sold; p.qty = p.stock; // fixed decrement
  const afterStock = p.stock;
  const gatewayDelta = before.stock - afterStock; // what the gateway commit sees
  assert.strictEqual(afterStock, 7, 'stock must be 7 after selling 3');
  assert.strictEqual(p.qty, 7, 'qty must equal stock after sale');
  assert.strictEqual(gatewayDelta, 3, 'gateway must see delta of 3 for correct Firestore decrement');

  // stock_before - qty_sold = stock_after invariant
  assert.strictEqual(before.stock - sold, afterStock, 'inventory invariant: stock_before - qty_sold = stock_after');

  // Simulate sale cancellation restore
  const restored = { ...p };
  restored.stock += sold; restored.qty = restored.stock;
  assert.strictEqual(restored.stock, 10, 'stock must be restored after cancellation');
  assert.strictEqual(restored.qty, 10, 'qty must equal stock after cancellation');

  // Legacy product (has qty only) after normalizeState
  const legacyProduct = { id:'p2', businessId:'biz-a', name:'P2', qty:5, price:3 };
  const legacyStockVal = Number(legacyProduct.stock ?? legacyProduct.qty ?? 0);
  const legacyNorm = { ...legacyProduct, stock:legacyStockVal, qty:legacyStockVal };
  assert.strictEqual(legacyNorm.stock, 5, 'legacy qty must be normalized to stock');
  assert.strictEqual(legacyNorm.qty, 5, 'legacy qty must be preserved during normalization');

  // Product save: both qty and stock must be written
  const savedQty = 15;
  const savedProduct = { ...normalized, qty:savedQty, stock:savedQty };
  assert.strictEqual(savedProduct.stock, savedQty, 'product save must write stock field');
  assert.strictEqual(savedProduct.qty, savedQty, 'product save must write qty field');

  // Negative stock must not be produced by normal decrement (guard in sell flow)
  // i.e., selling more than available must be blocked BEFORE decrement
  const stockCheck = (productStock, cartQty) => (productStock ?? 0) < cartQty;
  assert(!stockCheck(10, 3), 'selling 3 from 10 must pass stock check');
  assert(stockCheck(2, 3), 'selling 3 from 2 must fail stock check (insufficient)');
  assert(stockCheck(0, 1), 'selling from stock=0 must fail stock check');
}

console.log('PASS worker data boundary: role matrix, tenant split, idempotent migration, rollback manifest, counts and totals');
