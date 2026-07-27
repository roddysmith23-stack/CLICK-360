'use strict';

const assert = require('node:assert/strict');
const { ACTIONS, LogisticsError, normaliseLoadItems, total } = require('./functions/src/p2-logistics-service.cjs');

assert.equal(ACTIONS.has('closeRouteSettlement'), true);
const items = normaliseLoadItems([{ productId: 'product-a', name: 'Producto QA', qty: 2, price: 4 }]);
assert.equal(items[0].soldQty, 0);
assert.equal(total(items), 8);
assert.throws(() => normaliseLoadItems([]), LogisticsError);
console.log('P2 cloud logistics service harness: PASS');
