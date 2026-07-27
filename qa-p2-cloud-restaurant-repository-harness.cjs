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
vm.runInContext(fs.readFileSync('restaurant-repository.js', 'utf8'), context, { filename: 'restaurant-repository.js' });
const repo = context.CLICK360_P2_RESTAURANT_REPOSITORY;

(async () => {
  await repo.createOrder({ businessId: 'biz-alpha', orderId: 'order-a', tableId: 'table-a', items: [{ id: 'line-a', qty: 1, price: 10 }] }, { idempotencyKey: 'restaurant_create_0001' });
  await repo.recordPayment({ businessId: 'biz-alpha', orderId: 'order-a', amount: 10, method: 'Efectivo' }, { idempotencyKey: 'restaurant_payment_0001' });
  await repo.transition({ businessId: 'biz-alpha', orderId: 'order-a', status: 'accepted', area: 'kitchen' }, { idempotencyKey: 'restaurant_kds_0001' });
  assert.deepEqual(calls.map((entry) => entry.action), ['createRestaurantOrder', 'recordRestaurantPayment', 'transitionRestaurantOrder']);
  assert.equal(repo.offlineState().status, 'online');
  console.log('P2 cloud restaurant repository harness: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
