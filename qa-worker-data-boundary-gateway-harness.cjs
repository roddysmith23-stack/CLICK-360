const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { globalThis:{} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('worker-data-boundary.js', 'utf8'), context, { filename:'worker-data-boundary.js' });
const api = context.globalThis.CLICK360_WORKER_DATA_BOUNDARY;
const ownerUid = 'owner-gateway';
const businessId = 'business-gateway';
const workerUid = 'cashier-gateway';
const rootPath = `businesses/${ownerUid}/businessUnits/${businessId}`;
const fixedTimestamp = '2026-08-18T12:00:00.000Z';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function identity() { return api.identity(ownerUid, businessId); }
function record(moduleName, id, extra = {}) {
  return {
    id, ...identity(), module:moduleName, recordVersion:1,
    createdBy:ownerUid, updatedBy:ownerUid, createdAt:fixedTimestamp, updatedAt:fixedTimestamp,
    ...extra
  };
}

function createDb(seed) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, clone(value)]));
  const writes = [];
  const snapshot = (path) => ({ exists:store.has(path), data:() => clone(store.get(path)) });
  const docRef = (path) => ({
    path,
    collection:(name) => collectionRef(`${path}/${name}`),
    get:async () => snapshot(path)
  });
  const collectionRef = (path) => ({
    path,
    doc:(id) => docRef(`${path}/${id}`),
    get:async () => ({ docs:[...store.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .map(([key]) => ({ id:key.split('/').pop(), data:() => clone(store.get(key)) })) })
  });
  return {
    collection:(name) => collectionRef(name),
    batch:() => {
      const pending = [];
      return {
        set:(ref, value) => pending.push({ type:'set', path:ref.path, value:clone(value) }),
        update:(ref, value) => pending.push({ type:'update', path:ref.path, value:clone(value) }),
        commit:async () => {
          pending.forEach((write) => {
            if (write.type === 'set') store.set(write.path, clone(write.value));
            else {
              if (!store.has(write.path)) throw new Error(`Missing update target: ${write.path}`);
              store.set(write.path, { ...store.get(write.path), ...clone(write.value) });
            }
            writes.push(write);
          });
        }
      };
    },
    store,
    writes
  };
}

const permissions = api.normalizePermissionMap('cashier');
const seed = {
  [rootPath]:{ id:businessId, ...identity(), status:'CUTOVER_VERIFIED' },
  [`${rootPath}/members/${workerUid}`]:record('members', workerUid, { uid:workerUid, role:'cashier', permissions, status:'active' }),
  [`${rootPath}/products/product-a`]:record('products', 'product-a', { name:'Producto A', businessId, stock:5, price:4 }),
  [`${rootPath}/settings/main`]:record('settings', 'main', { business:{ id:businessId, name:'Negocio Gateway' } })
};
const db = createDb(seed);
const gateway = api.createFirestoreGateway({
  db,
  firebase:{ firestore:{ FieldValue:{ serverTimestamp:() => fixedTimestamp } } },
  user:{ uid:workerUid }, ownerUid, businessId, role:'cashier', permissions,
  projectId:'demo-click360-worker-gateway'
});

(async () => {
  const before = await gateway.pull();
  assert.strictEqual(before.products.length, 1);
  assert.strictEqual(before.settings.modularBoundary.status, 'CUTOVER_VERIFIED');
  const after = clone(before);
  after.products[0].stock = 4;
  after.sales.push({
    id:'sale-a', businessId, actorUid:workerUid, status:'paid', total:4, received:4,
    items:[{ productId:'product-a', name:'Producto A', qty:1, price:4, total:4 }]
  });
  const result = await gateway.commit(before, after);
  assert.strictEqual(result.writes, 2, 'sale and stock must share one modular batch');
  assert(db.writes.every((write) => write.path.startsWith(`${rootPath}/`)), 'all writes remain inside the business unit');
  assert(!db.writes.some((write) => write.path.includes('/state/main')), 'worker gateway never writes state/main');
  assert.strictEqual(db.store.get(`${rootPath}/sales/sale-a`).stockDeltas['product-a'], 1);
  assert.strictEqual(db.store.get(`${rootPath}/products/product-a`).lastOperationId, 'sale-a');

  const tampered = clone(after);
  tampered.products[0].stock = 3;
  await assert.rejects(() => gateway.commit(after, tampered), /Permiso denegado: products.update/);

  db.store.set(`${rootPath}/members/${workerUid}`, { ...db.store.get(`${rootPath}/members/${workerUid}`), status:'revoked' });
  await assert.rejects(() => gateway.verify(), /membresía modular no está activa/);
  console.log('PASS worker gateway: verified pull, atomic sale/stock, no state/main, permission denial and revocation');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
