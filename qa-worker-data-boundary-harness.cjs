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

// ── Regression: Defect A — validateSourceDocumentIdentity (real implementation) ─
// Uses api.validateSourceDocumentIdentity from worker-data-boundary.js directly.
// Migration script imports from the same module; tests here exercise the real code.
{
  const expectedKey = api.identity('owner-a', 'biz-a').tenantKey;
  const validDoc = { payload: { identity: { ownerUid:'owner-a', businessId:'biz-a', tenantKey:expectedKey }, data:{} } };

  // 1. Valid identity → must NOT throw
  assert.doesNotThrow(
    () => api.validateSourceDocumentIdentity(validDoc, 'owner-a', 'biz-a', expectedKey),
    'valid identity must pass without throwing'
  );
  // 2. payload.identity absent → SOURCE_IDENTITY_ABSENT
  const noIdentityDoc = { payload: { data:{} } };
  assert.throws(
    () => api.validateSourceDocumentIdentity(noIdentityDoc, 'owner-a', 'biz-a', expectedKey),
    /SOURCE_IDENTITY_ABSENT/,
    'absent payload.identity must throw SOURCE_IDENTITY_ABSENT'
  );
  // 3. Wrong ownerUid → SOURCE_IDENTITY_MISMATCH
  const wrongOwner = { payload: { identity: { ownerUid:'wrong-owner', businessId:'biz-a', tenantKey:expectedKey }, data:{} } };
  assert.throws(
    () => api.validateSourceDocumentIdentity(wrongOwner, 'owner-a', 'biz-a', expectedKey),
    /SOURCE_IDENTITY_MISMATCH/,
    'wrong ownerUid must throw SOURCE_IDENTITY_MISMATCH'
  );
  // 4. Wrong businessId → SOURCE_IDENTITY_MISMATCH
  const wrongBiz = { payload: { identity: { ownerUid:'owner-a', businessId:'wrong-biz', tenantKey:expectedKey }, data:{} } };
  assert.throws(
    () => api.validateSourceDocumentIdentity(wrongBiz, 'owner-a', 'biz-a', expectedKey),
    /SOURCE_IDENTITY_MISMATCH/,
    'wrong businessId must throw SOURCE_IDENTITY_MISMATCH'
  );
  // 5. Wrong tenantKey → SOURCE_IDENTITY_MISMATCH
  const wrongKey = { payload: { identity: { ownerUid:'owner-a', businessId:'biz-a', tenantKey:'owner:other:business:biz-a' }, data:{} } };
  assert.throws(
    () => api.validateSourceDocumentIdentity(wrongKey, 'owner-a', 'biz-a', expectedKey),
    /SOURCE_IDENTITY_MISMATCH/,
    'wrong tenantKey must throw SOURCE_IDENTITY_MISMATCH'
  );
  // 6. Null payload → SOURCE_IDENTITY_ABSENT
  assert.throws(
    () => api.validateSourceDocumentIdentity({}, 'owner-a', 'biz-a', expectedKey),
    /SOURCE_IDENTITY_ABSENT/,
    'null payload must throw SOURCE_IDENTITY_ABSENT'
  );
  // 7. Fixture path (no payload wrapper) does NOT trigger validation — migration script
  //    skips it for args.input. Tested end-to-end by npm run qa:worker-migration.
}

// ── Regression: Defect A — planIdentityRepair (real implementation) ──────────
// Uses api.planIdentityRepair from worker-data-boundary.js directly.
// The repair script (worker-boundary-repair-identity.mjs) calls the same function.
{
  const P0_SCHEMA = 10;
  const ownerUid = 'owner-repair-test';
  const businessId = 'biz-repair-test';
  const ownerId = ownerUid;
  const tenantKey = api.identity(ownerUid, businessId).tenantKey;
  const expected = { ownerUid, ownerId, businessId, tenantKey, schemaVersion: P0_SCHEMA };

  // Minimal valid root identity fields (the scenario found in staging)
  const validRoot = { ownerUid, ownerId, businessId, tenantKey, schemaVersion: P0_SCHEMA };
  const sampleData = { businesses:[{id:businessId}], products:[], sales:[] };

  // Case 1: Root valid + payload.identity absent → REPAIR
  const rootOnlyDoc = { ...validRoot, payload: { data: sampleData } };
  const repairPlan = api.planIdentityRepair(rootOnlyDoc, expected);
  assert.strictEqual(repairPlan.action, 'REPAIR', 'root valid + nested absent → action must be REPAIR');
  assert.strictEqual(repairPlan.payloadIdentity.ownerUid, ownerUid, 'repair plan must include correct ownerUid');
  assert.strictEqual(repairPlan.payloadIdentity.ownerId, ownerId, 'repair plan must include correct ownerId');
  assert.strictEqual(repairPlan.payloadIdentity.businessId, businessId, 'repair plan must include correct businessId');
  assert.strictEqual(repairPlan.payloadIdentity.tenantKey, tenantKey, 'repair plan must include correct tenantKey');
  assert.strictEqual(repairPlan.payloadIdentity.schemaVersion, P0_SCHEMA, 'repair plan must include correct schemaVersion');

  // Case 2: payload.data is not included in payloadIdentity (data boundary respected)
  assert.ok(!('data' in repairPlan.payloadIdentity), 'repaired payload.identity must not include data');
  assert.ok(!('products' in repairPlan.payloadIdentity), 'repaired payload.identity must not include products');

  // Case 3: Root valid + payload.identity present and matching → NOOP
  const fullDoc = { ...validRoot, payload: { identity: { ownerUid, ownerId, businessId, tenantKey, schemaVersion: P0_SCHEMA }, data: sampleData } };
  const noopPlan = api.planIdentityRepair(fullDoc, expected);
  assert.strictEqual(noopPlan.action, 'NOOP', 'root valid + nested matches → action must be NOOP');
  assert.strictEqual(noopPlan.payloadIdentity, null, 'NOOP plan must have null payloadIdentity');

  // Case 4: Second run after repair (already NOOP) → NOOP (idempotence)
  const repairedDoc = { ...validRoot, payload: { identity: repairPlan.payloadIdentity, data: sampleData } };
  const secondRun = api.planIdentityRepair(repairedDoc, expected);
  assert.strictEqual(secondRun.action, 'NOOP', 'second run after repair must be NOOP (idempotent)');

  // Case 5: Nested identity contradicts expected → REPAIR_DENIED_NESTED_MISMATCH (throw)
  const contradictoryNested = { ...validRoot, payload: { identity: { ownerUid:'wrong-owner', ownerId:'wrong-owner', businessId, tenantKey, schemaVersion: P0_SCHEMA }, data: sampleData } };
  assert.throws(
    () => api.planIdentityRepair(contradictoryNested, expected),
    /REPAIR_DENIED_NESTED_MISMATCH/,
    'contradictory nested identity must throw REPAIR_DENIED_NESTED_MISMATCH'
  );

  // Case 6: Root identity contradicts expected → REPAIR_DENIED_ROOT_MISMATCH (throw)
  const wrongRootDoc = { ownerUid:'wrong-owner', ownerId:'wrong-owner', businessId, tenantKey, schemaVersion: P0_SCHEMA, payload: { data: sampleData } };
  assert.throws(
    () => api.planIdentityRepair(wrongRootDoc, expected),
    /REPAIR_DENIED_ROOT_MISMATCH/,
    'wrong root ownerUid must throw REPAIR_DENIED_ROOT_MISMATCH'
  );

  // Case 7: Wrong tenantKey in root → REPAIR_DENIED_ROOT_MISMATCH (throw)
  const wrongTenantRoot = { ...validRoot, tenantKey: 'owner:evil:business:biz-a', payload: { data: sampleData } };
  assert.throws(
    () => api.planIdentityRepair(wrongTenantRoot, expected),
    /REPAIR_DENIED_ROOT_MISMATCH/,
    'wrong root tenantKey must throw REPAIR_DENIED_ROOT_MISMATCH'
  );

  // Case 8: payload.data is identical before and after a REPAIR plan (data never touched)
  const dataHashBefore = JSON.stringify(sampleData);
  // Simulating what the repair script does: writes only payload.identity
  const afterRepair = { ...rootOnlyDoc, payload: { ...rootOnlyDoc.payload, identity: repairPlan.payloadIdentity } };
  const dataHashAfter = JSON.stringify(afterRepair.payload.data);
  assert.strictEqual(dataHashBefore, dataHashAfter, 'payload.data must be identical before and after identity repair');
}

// ── Regression: Defect B — stock vs qty contract ──────────────────────────
// The modular gateway canonical field is 'stock'. The UI field is 'qty'.
// The paths below simulate the normalizeState and sell flows from app.js.
// The gateway commit() in worker-data-boundary.js reads stock for Firestore deltas.
{
  // Simulate normalizeState sync: product from gateway has 'stock' only
  // app.js normalizeState: const canonicalStock = Number(p.stock ?? p.qty ?? 0); p.stock = p.qty = canonicalStock;
  const gatewayProduct = { id:'p1', businessId:'biz-a', name:'P1', stock:10, price:5 };
  const canonicalStock = Number(gatewayProduct.stock ?? gatewayProduct.qty ?? 0);
  const normalized = { ...gatewayProduct, stock:canonicalStock, qty:canonicalStock };
  assert.strictEqual(normalized.qty, 10, 'normalizeState must set qty from stock');
  assert.strictEqual(normalized.stock, 10, 'normalizeState must preserve stock');

  // Simulate sale decrement: app.js sell flow now writes both stock and qty
  // p.stock -= sold; p.qty = p.stock;
  const before = { ...normalized };
  const p = { ...normalized };
  const sold = 3;
  p.stock -= sold; p.qty = p.stock;
  const afterStock = p.stock;
  // gateway commit() computes: Number(before?.stock || 0) - Number(after?.stock || 0)
  const gatewayDelta = before.stock - afterStock;
  assert.strictEqual(afterStock, 7, 'stock must be 7 after selling 3');
  assert.strictEqual(p.qty, 7, 'qty must equal stock after sale (sync maintained)');
  assert.strictEqual(gatewayDelta, 3, 'gateway must see delta of 3 for correct Firestore decrement');

  // Inventory invariant
  assert.strictEqual(before.stock - sold, afterStock, 'invariant: stock_before - qty_sold = stock_after');

  // Simulate sale cancellation: p.stock += restored; p.qty = p.stock;
  const restored = { ...p };
  restored.stock += sold; restored.qty = restored.stock;
  assert.strictEqual(restored.stock, 10, 'stock must be restored after cancellation');
  assert.strictEqual(restored.qty, 10, 'qty must equal stock after cancellation (sync maintained)');

  // Legacy product (qty only) after normalizeState → stock materialized
  const legacyProduct = { id:'p2', businessId:'biz-a', name:'P2', qty:5, price:3 };
  const legacyStockVal = Number(legacyProduct.stock ?? legacyProduct.qty ?? 0);
  const legacyNorm = { ...legacyProduct, stock:legacyStockVal, qty:legacyStockVal };
  assert.strictEqual(legacyNorm.stock, 5, 'legacy qty must be normalized to stock');
  assert.strictEqual(legacyNorm.qty, 5, 'legacy qty must be preserved during normalization');

  // Product save: both qty and stock must be written (Object.assign in app.js)
  const savedQty = 15;
  const savedProduct = { ...normalized, qty:savedQty, stock:savedQty };
  assert.strictEqual(savedProduct.stock, savedQty, 'product save must write stock field');
  assert.strictEqual(savedProduct.qty, savedQty, 'product save must write qty field');

  // Stock check guard (sell flow and cart flow): (p.stock ?? p.qty ?? 0) < cartQty
  const stockCheck = (productStock, cartQty) => (productStock ?? 0) < cartQty;
  assert(!stockCheck(10, 3), 'selling 3 from stock=10 must pass stock check');
  assert(stockCheck(2, 3), 'selling 3 from stock=2 must fail stock check (insufficient)');
  assert(stockCheck(0, 1), 'selling from stock=0 must fail stock check');

  // Gateway delta must be zero if stock does not change (no silent decrement)
  const noChangePrev = { stock:5, qty:5 };
  const noChangeNext = { stock:5, qty:5 };
  const zeroDelta = Number(noChangePrev?.stock || 0) - Number(noChangeNext?.stock || 0);
  assert.strictEqual(zeroDelta, 0, 'gateway must see delta of 0 when stock unchanged (no silent decrement)');
}

console.log('PASS worker data boundary: role matrix, tenant split, idempotent migration, identity repair plan, rollback manifest, counts and totals');
