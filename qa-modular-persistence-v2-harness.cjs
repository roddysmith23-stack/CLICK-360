const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const { TextEncoder } = require('util');

const context = {
  crypto:crypto.webcrypto,
  TextEncoder,
  Uint8Array,
  globalThis:{ crypto:crypto.webcrypto, TextEncoder, Uint8Array, Object, JSON, Map, Set, Number, String, Array, Error }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('modular-persistence.js', 'utf8'), context, { filename:'modular-persistence.js' });
const api = context.globalThis.CLICK360_MODULAR_PERSISTENCE;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  let queue = Promise.resolve();
  let lastReadCount = 0;
  const snapshot = (path) => ({ exists:store.has(path), data:() => clone(store.get(path)) });
  const docRef = (path) => ({
    path,
    collection:(name) => collectionRef(`${path}/${name}`),
    get:async () => snapshot(path)
  });
  const collectionRef = (path) => ({ path, doc:(id) => docRef(`${path}/${id}`) });
  return {
    collection:(name) => collectionRef(name),
    runTransaction(callback) {
      const execute = async () => {
        const writes = [];
        let reads = 0;
        const transaction = {
          get:async (reference) => { reads += 1; return snapshot(reference.path); },
          set:(reference, value) => writes.push({ type:'set', path:reference.path, value:clone(value) }),
          update:(reference, value) => writes.push({ type:'update', path:reference.path, value:clone(value) })
        };
        const result = await callback(transaction);
        writes.forEach((write) => {
          if (write.type === 'set') store.set(write.path, write.value);
          else {
            if (!store.has(write.path)) throw new Error(`Missing update target: ${write.path}`);
            store.set(write.path, { ...store.get(write.path), ...write.value });
          }
        });
        lastReadCount = reads;
        return result;
      };
      const current = queue.then(execute, execute);
      queue = current.then(() => undefined, () => undefined);
      return current;
    },
    store,
    get lastReadCount() { return lastReadCount; }
  };
}

function baseRecord(ownerUid, businessId, moduleName, id, extra = {}) {
  return {
    id,
    ...api.identity(ownerUid, businessId),
    module:moduleName,
    recordVersion:1,
    createdBy:ownerUid,
    updatedBy:ownerUid,
    createdAt:'2026-09-27T00:00:00.000Z',
    updatedAt:'2026-09-27T00:00:00.000Z',
    ...extra
  };
}

function seedTenant(seed, ownerUid, businessId, products = []) {
  const rootPath = `businesses/${ownerUid}/businessUnits/${businessId}`;
  seed[`businesses/${ownerUid}/featureFlags/modularStorage`] = {
    enabled:true,
    writeMode:'modular',
    schemaVersion:2,
    businessIds:[businessId]
  };
  seed[rootPath] = {
    ...api.identity(ownerUid, businessId),
    id:businessId,
    status:'CUTOVER_VERIFIED',
    legacyWriteFence:api.LEGACY_WRITE_FENCE
  };
  products.forEach((product) => {
    seed[`${rootPath}/products/${product.id}`] = baseRecord(ownerUid, businessId, 'products', product.id, product);
  });
  return rootPath;
}

const firebase = { firestore:{ FieldValue:{ serverTimestamp:() => 'SERVER_TIMESTAMP' } } };

(async () => {
  assert(api, 'modular persistence API must initialize');
  assert.strictEqual(api.SCHEMA_VERSION, 2);
  assert.deepStrictEqual([...api.MODULES], [
    'products', 'sales', 'movements', 'cashSessions', 'dailyReports',
    'auditEvents', 'config', 'metadata', 'operationLedger', 'storageTelemetry'
  ]);
  assert.strictEqual(api.occupancy(679999).level, 'normal');
  assert.strictEqual(api.occupancy(680000).level, 'warning');
  assert.strictEqual(api.occupancy(807500).level, 'critical');

  const source = fs.readFileSync('modular-persistence.js', 'utf8');
  assert(!source.includes("collection('state').doc('main')"), 'repository must never write state/main');
  assert(source.includes('PRODUCTION_MODULAR_WRITES_REQUIRE_SEPARATE_AUTHORIZATION'), 'production must fail closed without separate authorization');
  assert(source.includes('legacyWriteFence'), 'cutover must require the legacy write fence');
  assert(source.includes('runTransaction'), 'critical mutations must use transactions');

  const seed = {};
  const ownerA = 'owner-a';
  const businessA = 'business-a';
  const rootA = seedTenant(seed, ownerA, businessA, [
    { id:'product-a', name:'Producto A', stock:5, qty:5, price:33 },
    { id:'product-race', name:'Producto concurrencia', stock:1, qty:1, price:10 }
  ]);
  seed[`${rootA}/cashSessions/cash-0903`] = baseRecord(ownerA, businessA, 'cashSessions', 'cash-0903', {
    date:'2026-09-03', status:'open', openingAmount:0
  });
  seed[`${rootA}/cashSessions/cash-existing`] = baseRecord(ownerA, businessA, 'cashSessions', 'cash-existing', {
    date:'2026-09-04', status:'closed', reportId:'report-cash-existing'
  });
  seed[`${rootA}/dailyReports/report-cash-existing`] = baseRecord(ownerA, businessA, 'dailyReports', 'report-cash-existing', {
    date:'2026-09-04', status:'closed', cashSessionId:'cash-existing', saleIds:[], renderVersion:'cash-close-structured-v1'
  });

  const ownerB = 'owner-b';
  const businessB = 'business-b';
  const rootB = seedTenant(seed, ownerB, businessB, [{ id:'product-b', name:'Producto B', stock:9, qty:9, price:2 }]);

  for (let index = 0; index < 5000; index += 1) {
    seed[`${rootA}/sales/history-${index}`] = baseRecord(ownerA, businessA, 'sales', `history-${index}`, { total:1, items:[] });
    seed[`${rootA}/movements/history-${index}`] = baseRecord(ownerA, businessA, 'movements', `history-${index}`, { amount:1 });
    seed[`${rootA}/auditEvents/history-${index}`] = baseRecord(ownerA, businessA, 'auditEvents', `history-${index}`, { action:'history' });
  }

  const db = createDb(seed);
  const repositoryA = api.createFirestoreRepository({
    db,
    firebase,
    user:{ uid:'cashier-a' },
    ownerUid:ownerA,
    businessId:businessA,
    projectId:'demo-click360-modular-v2'
  });

  assert.throws(() => api.createFirestoreRepository({
    db,
    firebase,
    user:{ uid:'cashier-a' },
    ownerUid:ownerA,
    businessId:businessA,
    projectId:'click-360'
  }), /SEPARATE_AUTHORIZATION/);

  const saleInput = {
    operationId:'sale-op-0903',
    sale:{ id:'legacy-sale-0903', date:'2026-09-03', status:'paid', total:30, method:'Transferencia', items:[{ productId:'product-a', qty:1, price:33 }] },
    movement:{ date:'2026-09-03', kind:'ingreso', amount:30, paymentMethod:'Transferencia', cashSessionId:'cash-0903' },
    productChanges:[{ productId:'product-a', quantity:1, expectedStock:5, expectedRecordVersion:1 }]
  };
  const duplicateSaleResults = await Promise.all([
    repositoryA.commitSale(saleInput),
    repositoryA.commitSale(saleInput)
  ]);
  assert.deepStrictEqual(duplicateSaleResults.map((result) => result.status).sort(), ['already_committed', 'committed']);
  assert.strictEqual(db.store.get(`${rootA}/products/product-a`).stock, 4, 'double submission decrements stock once');
  assert.strictEqual(db.store.get(`${rootA}/products/product-a`).qty, 4, 'legacy qty mirror remains consistent');
  assert.strictEqual(db.store.get(`${rootA}/sales/sale-op-0903`).total, 30);
  assert.strictEqual(db.store.get(`${rootA}/movements/sale-op-0903`).amount, 30);
  assert.strictEqual(db.store.get(`${rootA}/operationLedger/sale-op-0903`).status, 'committed');
  assert(db.lastReadCount <= 3, 'idempotent retry reads only readiness plus one ledger record');
  assert.strictEqual(db.store.get(`${rootB}/products/product-b`).stock, 9, 'tenant B stays untouched');

  await assert.rejects(() => repositoryA.commitSale({
    ...saleInput,
    sale:{ ...saleInput.sale, total:31 },
    movement:{ ...saleInput.movement, amount:31 }
  }), /IDEMPOTENCY_KEY_CONFLICT/);
  assert.strictEqual(db.store.get(`${rootA}/products/product-a`).stock, 4, 'idempotency conflict cannot touch inventory');

  const race = (operationId) => repositoryA.commitSale({
    operationId,
    sale:{ date:'2026-09-03', status:'paid', total:10, method:'Efectivo', items:[{ productId:'product-race', qty:1, price:10 }] },
    movement:{ date:'2026-09-03', kind:'ingreso', amount:10, cashSessionId:'cash-0903' },
    productChanges:[{ productId:'product-race', quantity:1, expectedStock:1, expectedRecordVersion:1 }]
  });
  const raceResults = await Promise.allSettled([race('race-device-a'), race('race-device-b')]);
  assert.strictEqual(raceResults.filter((result) => result.status === 'fulfilled').length, 1, 'only one device may consume the last unit');
  assert.strictEqual(raceResults.filter((result) => result.status === 'rejected').length, 1, 'the losing device receives a conflict');
  assert.strictEqual(db.store.get(`${rootA}/products/product-race`).stock, 0);

  const closeInput = {
    operationId:'close-op-0903',
    cashSessionId:'cash-0903',
    report:{ date:'2026-09-03', saleIds:['sale-op-0903'], closeCash:0, expectedCash:0, difference:0 }
  };
  const duplicateCloseResults = await Promise.all([
    repositoryA.closeCashSession(closeInput),
    repositoryA.closeCashSession(closeInput)
  ]);
  assert.deepStrictEqual(duplicateCloseResults.map((result) => result.status).sort(), ['already_committed', 'committed']);
  assert.strictEqual(db.store.get(`${rootA}/cashSessions/cash-0903`).status, 'closed');
  assert.strictEqual(db.store.get(`${rootA}/cashSessions/cash-0903`).reportId, 'report-cash-0903');
  assert.strictEqual(db.store.get(`${rootA}/dailyReports/report-cash-0903`).renderVersion, 'cash-close-structured-v1');
  assert(!Object.hasOwn(db.store.get(`${rootA}/dailyReports/report-cash-0903`), 'html'), 'reports remain compact and derived');
  assert.strictEqual(db.store.get(`${rootA}/products/product-a`).stock, 4, 'cash close never changes stock');
  assert.strictEqual(db.store.get(`${rootA}/sales/sale-op-0903`).total, 30, 'cash close never duplicates or mutates the sale');

  const confirmed = await repositoryA.closeCashSession({
    operationId:'close-existing',
    cashSessionId:'cash-existing',
    report:{ id:'report-cash-existing', date:'2026-09-04', saleIds:[] }
  });
  assert.strictEqual(confirmed.status, 'confirmed_existing', 'a server-confirmed close is recognized before retrying');
  await assert.rejects(() => repositoryA.closeCashSession({
    operationId:'close-existing',
    cashSessionId:'cash-existing',
    report:{ id:'report-cash-existing', date:'2026-09-05', saleIds:[] }
  }), /CASH_CLOSE_(STATE_CONFLICT|DATE_MISMATCH)/, 'a same-id report with different content must fail closed');

  const disabledSeed = {};
  const disabledRoot = seedTenant(disabledSeed, 'owner-disabled', 'business-disabled', [{ id:'p', stock:1, qty:1 }]);
  disabledSeed['businesses/owner-disabled/featureFlags/modularStorage'].enabled = false;
  const disabledDb = createDb(disabledSeed);
  const disabledRepository = api.createFirestoreRepository({
    db:disabledDb,
    firebase,
    user:{ uid:'owner-disabled' },
    ownerUid:'owner-disabled',
    businessId:'business-disabled',
    projectId:'demo-click360-modular-v2'
  });
  await assert.rejects(() => disabledRepository.commitSale({
    operationId:'disabled-sale',
    sale:{ total:1, items:[{ productId:'p', qty:1, price:1 }] },
    movement:{ amount:1, cashSessionId:'disabled-cash' },
    productChanges:[{ productId:'p', quantity:1, expectedStock:1, expectedRecordVersion:1 }]
  }), /FEATURE_FLAG_DISABLED/);
  assert.strictEqual(disabledDb.store.get(`${disabledRoot}/products/p`).stock, 1, 'disabled tenant remains unchanged');

  console.log('PASS modular persistence: transactional idempotent sale/stock/movement, compact cash close, response-loss confirmation, tenant isolation, business flag, production gate, telemetry, 15k-history constant reads');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
