'use strict';

const assert = require('node:assert/strict');
const {
  ACTIONS,
  RestaurantError,
  normalizeItems,
  totalFor,
  transitionAllowed
} = require('./functions/src/p2-restaurant-service.cjs');

assert.equal(ACTIONS.has('recordRestaurantPayment'), true);
assert.equal(transitionAllowed('preparing', 'ready'), true);
assert.equal(transitionAllowed('paid', 'ready'), false);
const items = normalizeItems([{ id: 'line-a', productId: 'sku-a', name: 'Producto QA', qty: 2, price: 4.5, area: 'kitchen' }]);
assert.equal(totalFor(items), 9);
assert.throws(() => normalizeItems([]), RestaurantError);
console.log('P2 cloud restaurant service harness: PASS');
