#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const context = { console, Date, Math, Object, Array, Set, String, Number, Boolean, RegExp, Error };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync('p2-restaurant-domain.js', 'utf8'), context, { filename: 'p2-restaurant-domain.js' });
const R = context.CLICK360_P2_RESTAURANT;

const owner = { uid: 'owner-alpha', roleId: 'owner' };
const server = { uid: 'server-alpha', roleId: 'server' };
const kitchen = { uid: 'kitchen-alpha', roleId: 'kitchen' };
const cashier = { uid: 'cashier-alpha', roleId: 'cashier' };
const now = 1_700_000_000_000;

function replace(orders, next) { return orders.map((order) => order.id === next.id ? next : order); }

(() => {
  assert.equal(R.hasPermission(server, 'orders.create'), true, 'server can open an order');
  assert.equal(R.hasPermission(server, 'cash.close'), false, 'server cannot close cash');
  assert.equal(R.hasPermission(kitchen, 'kitchen.update'), true, 'kitchen can progress its queue');
  assert.equal(R.hasPermission(kitchen, 'cash.read'), false, 'kitchen cannot access cash');
  assert.equal(R.hasPermission(cashier, 'sales.create'), true, 'cashier can register a restaurant payment');
  assert.equal(R.hasPermission(cashier, 'orders.cancel'), false, 'cashier cannot cancel an order without an explicit grant');
  let order = R.createOrder({ businessId: 'biz-alpha', tableId: 'table-1', serverId: server.uid, actor: server, now, id: 'order-alpha' });
  assert.equal(order.status, 'draft');
  assert.equal(order.tableState, 'occupied');

  order = R.addLine({ order, actor: server, now: now + 1, line: { id: 'line-food', productId: 'food', name: 'Plato de prueba', qty: 2, price: 8, notes: 'Sin ingrediente opcional', area: 'kitchen' } });
  order = R.addLine({ order, actor: server, now: now + 2, line: { id: 'line-drink', productId: 'drink', name: 'Bebida de prueba', qty: 1, price: 3, area: 'bar', priority: 'high' } });
  assert.equal(R.orderSubtotal(order), 19, 'items calculate a deterministic order total');
  assert.throws(() => R.addLine({ order, actor: kitchen, line: { name: 'No autorizado', qty: 1, price: 1 } }), /permission_denied:orders.update/);

  order = R.sendRound({ order, actor: server, now: now + 3 });
  assert.equal(order.status, 'sent');
  assert.equal(order.rounds.length, 1);
  const kitchenQueue = R.kitchenQueue([order], { businessId: 'biz-alpha', area: 'kitchen', now: now + 300_000 });
  const barQueue = R.kitchenQueue([order], { businessId: 'biz-alpha', area: 'bar', now: now + 300_000 });
  assert.equal(kitchenQueue.length, 1, 'kitchen only receives kitchen lines');
  assert.equal(kitchenQueue[0].items[0].id, 'line-food');
  assert.equal(barQueue[0].items[0].id, 'line-drink', 'bar only receives bar lines');

  order = R.transitionOrder({ order, status: 'accepted', actor: kitchen, now: now + 4, area: 'kitchen' });
  order = R.transitionOrder({ order, status: 'preparing', actor: kitchen, now: now + 5, area: 'kitchen' });
  order = R.transitionOrder({ order, status: 'ready', actor: kitchen, now: now + 6, area: 'kitchen' });
  order = R.transitionOrder({ order, status: 'delivered', actor: kitchen, now: now + 7, area: 'kitchen' });
  assert.equal(order.status, 'sent', 'a drink still pending at the bar keeps the overall order open');
  assert.equal(R.areaStatusFor(order, 'kitchen'), 'delivered');
  assert.equal(R.areaStatusFor(order, 'bar'), 'sent');
  assert.equal(R.kitchenQueue([order], { businessId: 'biz-alpha', area: 'kitchen' }).length, 0, 'a completed kitchen area leaves its own queue');
  assert.equal(R.kitchenQueue([order], { businessId: 'biz-alpha', area: 'bar' }).length, 1, 'the bar queue remains independent');
  order = R.transitionOrder({ order, status: 'accepted', actor: kitchen, now: now + 8, area: 'bar' });
  order = R.transitionOrder({ order, status: 'preparing', actor: kitchen, now: now + 9, area: 'bar' });
  order = R.transitionOrder({ order, status: 'ready', actor: kitchen, now: now + 10, area: 'bar' });
  order = R.transitionOrder({ order, status: 'delivered', actor: kitchen, now: now + 11, area: 'bar' });
  assert.equal(order.status, 'delivered');
  assert.equal(order.tableState, 'to_charge');
  assert.throws(() => R.transitionOrder({ order, status: 'paid', actor: cashier }), /invalid_order_transition/);

  const splitByPerson = R.splitOrder({ order, mode: 'person', parts: 2, actor: server, now: now + 12 });
  assert.equal(splitByPerson.splitPlan.parts, 2);
  assert.equal(splitByPerson.splitPlan.mode, 'person');
  assert.equal(splitByPerson.splitPlan.groups.reduce((sum, group) => sum + group.amount, 0), 19, 'equal split preserves the exact total');
  const splitByProduct = R.splitOrder({ order, mode: 'product', parts: 2, actor: server, now: now + 13 });
  assert.equal(splitByProduct.splitPlan.mode, 'product');
  assert.equal(splitByProduct.splitPlan.groups.reduce((sum, group) => sum + group.amount, 0), 19, 'product split preserves the exact total');
  const splitByQuantity = R.splitOrder({ order, mode: 'quantity', parts: 2, actor: server, now: now + 14 });
  assert.equal(splitByQuantity.splitPlan.groups.reduce((sum, group) => sum + group.amount, 0), 19, 'quantity split preserves the exact total');

  const first = R.recordPayment({ order, amount: 10, method: 'Efectivo', actor: cashier, idempotencyKey: 'payment-1', now: now + 10 });
  order = first.order;
  assert.equal(order.remaining, 9);
  const duplicate = R.recordPayment({ order, amount: 10, method: 'Efectivo', actor: cashier, idempotencyKey: 'payment-1', now: now + 11 });
  assert.equal(duplicate.noop, true, 'same idempotency key is a safe no-op');
  assert.equal(duplicate.order.payments.length, 1, 'duplicate charge is never recorded twice');
  assert.throws(() => R.recordPayment({ order, amount: 10, method: 'Tarjeta', actor: cashier, idempotencyKey: 'payment-over' }), /payment_exceeds_balance/);
  order = R.recordPayment({ order, amount: 9, method: 'Tarjeta', actor: cashier, idempotencyKey: 'payment-2', now: now + 12 }).order;
  order = R.finalizePayment({ order, actor: cashier, now: now + 13 });
  assert.equal(order.status, 'paid');
  assert.equal(order.remaining, 0);
  assert.throws(() => R.addLine({ order, actor: server, line: { name: 'Late line', qty: 1, price: 1 } }), /order_not_editable/);

  let discountedOrder = R.createOrder({ businessId: 'biz-alpha', tableId: 'table-discount', actor: owner, now: now + 14, id: 'order-discount' });
  discountedOrder = R.addLine({ order: discountedOrder, actor: owner, now: now + 15, line: { id: 'discount-line', name: 'Producto con descuento', qty: 1, price: 10 } });
  assert.throws(() => R.applyDiscount({ order: discountedOrder, amount: 2, reason: 'Promoción', actor: cashier }), /permission_denied:sales.cancel/);
  discountedOrder = R.applyDiscount({ order: discountedOrder, amount: 2, reason: 'Promoción', actor: owner, now: now + 16 });
  assert.equal(discountedOrder.subtotal, 10);
  assert.equal(discountedOrder.discount, 2);
  assert.equal(discountedOrder.total, 8, 'the payable total reflects an authorised discount');
  assert.equal(discountedOrder.remaining, 8);
  const discountedSplit = R.splitOrder({ order: discountedOrder, mode: 'person', parts: 3, actor: owner, now: now + 17 });
  assert.equal(discountedSplit.splitPlan.groups.reduce((sum, group) => sum + group.amount, 0), 8, 'split plans preserve the discounted payable amount');
  discountedOrder = R.recordPayment({ order: discountedOrder, amount: 8, method: 'Transferencia', actor: cashier, idempotencyKey: 'discount-payment', now: now + 18 }).order;
  discountedOrder = R.finalizePayment({ order: discountedOrder, actor: cashier, now: now + 19 });
  assert.equal(discountedOrder.status, 'paid');

  let cancelOrder = R.createOrder({ businessId: 'biz-alpha', tableId: 'table-2', actor: server, now: now + 20, id: 'order-cancel' });
  cancelOrder = R.addLine({ order: cancelOrder, actor: server, now: now + 21, line: { id: 'cancel-line', name: 'Cancelado', qty: 1, price: 5 } });
  assert.throws(() => R.cancelLine({ order: cancelOrder, lineId: 'cancel-line', reason: 'Duplicado', actor: server }), /permission_denied:orders.cancel/);
  cancelOrder = R.cancelLine({ order: cancelOrder, lineId: 'cancel-line', reason: 'Duplicado', actor: owner, now: now + 22 });
  assert.equal(R.orderSubtotal(cancelOrder), 0, 'authorised cancellation removes a line from the financial total');
  const wholeCancellation = R.transitionOrder({ order: R.createOrder({ businessId: 'biz-alpha', tableId: 'table-4', actor: server, id: 'order-whole-cancel', now: now + 23 }), status: 'cancelled', actor: owner, now: now + 24 });
  assert.equal(wholeCancellation.status, 'cancelled', 'only an authorised actor can cancel an entire order');

  const moved = R.moveOrder({ order: R.normalizeOrder({ id: 'move-order', businessId: 'biz-alpha', tableId: 'table-1', status: 'draft' }, now), tableId: 'table-3', actor: server, now: now + 30 });
  assert.equal(moved.tableId, 'table-3');
  assert.throws(() => R.moveOrder({ order: moved, tableId: 'table-9', actor: kitchen }), /permission_denied:tables.write/);
  const otherBusiness = R.createOrder({ businessId: 'biz-bravo', tableId: 'other-table', actor: server, now: now + 31, id: 'order-bravo' });
  assert.throws(() => R.mergeOrders({ target: moved, source: otherBusiness, actor: server }), /cross_business_denied/, 'orders cannot merge across businesses');
  assert.throws(() => R.mergeOrders({ target: moved, source: { ...order, id: 'paid-source' }, actor: server }), /merge_paid_order_forbidden/, 'orders with payments cannot be merged silently');

  const report = R.restaurantReport([order, discountedOrder, cancelOrder, wholeCancellation], { businessId: 'biz-alpha' });
  assert.equal(report.paidOrders, 2);
  assert.equal(report.sales, 27);
  assert.equal(report.discounts, 2);
  assert.equal(report.salesByTable['table-1'], 19);
  assert.equal(report.cashByMethod.Transferencia, 8);
  assert.equal(report.cancelledOrders, 1, 'line cancellation does not cancel the whole order, but an authorised full cancellation is reported');
  const html = R.printDocument({ order, businessName: 'Negocio QA', kind: 'final' });
  assert.match(html, /CUENTA FINAL/);
  assert.match(html, /Plato de prueba/);
  assert.doesNotMatch(html, /<script/i, 'print output is escaped');
  const discountHtml = R.printDocument({ order: discountedOrder, businessName: 'Negocio QA', kind: 'final' });
  assert.match(discountHtml, /Descuento: -2\.00/);

  console.log('P2 restaurant advanced harness: PASS');
})();
