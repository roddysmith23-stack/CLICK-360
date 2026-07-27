'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const calls = [];
const fakeCollection = () => ({ doc: () => ({ get: async () => ({ exists: false }), onSnapshot: () => () => {} }) });
const context = {
  console,
  globalThis: null,
  CLICK360_P2_CLOUD_CLIENT: {
    call: async (action, input, options) => { calls.push({ action, input, options }); return { action, input }; },
    businessRef: () => ({ collection: fakeCollection }),
    safeId: (value) => value,
    collectionItems: () => () => {},
    offlineState: () => ({ status: 'online' })
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('logistics-repository.js', 'utf8'), context, { filename: 'logistics-repository.js' });
const repo = context.CLICK360_P2_LOGISTICS_REPOSITORY;

(async () => {
  await repo.createVehicle({ businessId: 'biz-alpha', vehicleId: 'vehicle-a', plate: 'ABC-123' }, { idempotencyKey: 'logistics_vehicle_0001' });
  await repo.dispatchLoadSheet({ businessId: 'biz-alpha', routeId: 'route-a', loadSheetId: 'sheet-a' }, { idempotencyKey: 'logistics_dispatch_0001' });
  await repo.recordCollection({ businessId: 'biz-alpha', routeId: 'route-a', saleId: 'sale-a', amount: 4 }, { idempotencyKey: 'logistics_collection_0001' });
  assert.deepEqual(calls.map((entry) => entry.action), ['createVehicle', 'dispatchLoadSheet', 'recordCollection']);
  assert.equal(repo.offlineState().status, 'online');
  console.log('P2 cloud logistics repository harness: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
