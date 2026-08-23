#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const context = { console, Date, Math, Object, Array, Set, String, Number, Boolean, RegExp, Error };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync('p2-logistics-domain.js', 'utf8'), context, { filename: 'p2-logistics-domain.js' });
const L = context.CLICK360_P2_LOGISTICS;

const owner = { uid:'owner-alpha', roleId:'owner' };
const routeSeller = { uid:'seller-alpha', roleId:'routeSeller' };
const collector = { uid:'collector-alpha', roleId:'collector' };
const readonly = { uid:'readonly-alpha', roleId:'readonly' };
const now = 1_700_000_000_000;

(() => {
  assert.equal(L.hasPermission(routeSeller, 'routeSales.create'), true);
  assert.equal(L.hasPermission(routeSeller, 'routeSales.discount'), false);
  assert.equal(L.hasPermission(routeSeller, 'collections.write'), false);
  assert.equal(L.hasPermission(collector, 'collections.write'), true);
  assert.equal(L.hasPermission(collector, 'loadSheets.write'), false);
  assert.equal(L.hasPermission(readonly, 'routeSales.create'), false);

  const productA = { id:'product-a', businessId:'biz-alpha', code:'A-001', name:'Producto A', qty:10, price:10 };
  const productB = { id:'product-b', businessId:'biz-alpha', code:'B-001', name:'Producto B', qty:8, price:5 };
  let products = [productA, productB];
  const vehicle = L.createVehicle({ input:{ id:'vehicle-a', businessId:'biz-alpha', plate:'abc-123', name:'Unidad QA', capacity:100 }, actor:owner, now });
  assert.equal(vehicle.plate, 'ABC-123');
  let route = L.createRoute({ input:{ id:'route-a', businessId:'biz-alpha', name:'Ruta QA Norte', zone:'Zona QA', date:'2026-07-27', vehicleId:vehicle.id }, vehicle, actor:owner, now:now + 1 });
  route = L.assignRoute({ route, vehicle, seller:{ uid:routeSeller.uid, name:'Vendedor QA' }, helper:{ uid:'helper-a', name:'Ayudante QA' }, collector:{ uid:collector.uid, name:'Cobrador QA' }, actor:owner, now:now + 2 });
  assert.equal(route.status, 'planned');
  assert.equal(route.sellerId, routeSeller.uid);
  assert.equal(route.collectorId, collector.uid);
  assert.equal(L.canAccessRoute(route, routeSeller, 'seller'), true);
  assert.equal(L.canAccessRoute(route, collector, 'collector'), true);
  assert.equal(L.canAccessRoute(route, { uid:'seller-bravo', roleId:'routeSeller' }, 'seller'), false);

  let sheet = L.createLoadSheet({ input:{ id:'sheet-a', businessId:'biz-alpha' }, route, actor:owner, now:now + 3 });
  sheet = L.addLoadItem({ sheet, product:productA, qty:3, routePrice:10, actor:owner, now:now + 4 });
  sheet = L.addLoadItem({ sheet, product:productB, qty:2, routePrice:5, actor:owner, now:now + 5 });
  assert.throws(() => L.addLoadItem({ sheet, product:{ ...productA, businessId:'biz-bravo' }, qty:1, actor:owner }), /cross_business_denied/);
  sheet = L.confirmLoadSheet({ sheet, products, actor:owner, now:now + 6 });
  assert.equal(sheet.status, 'confirmed');
  const dispatch = L.dispatchLoadSheet({ sheet, route, products, actor:owner, now:now + 7 });
  sheet = dispatch.sheet; route = dispatch.route; products = dispatch.products;
  assert.equal(sheet.status, 'dispatched');
  assert.equal(route.status, 'dispatched');
  assert.equal(products.find((product) => product.id === productA.id).qty, 7, 'dispatch decrements inventory once');
  assert.equal(L.dispatchLoadSheet({ sheet, route, products, actor:owner }).noop, true, 'repeat dispatch is an idempotent no-op');

  let routeSales = [];
  const cashSale = L.createRouteSale({ input:{ id:'sale-cash', businessId:'biz-alpha', customerId:'customer-a', customerName:'Cliente QA A', paymentType:'cash', items:[{ productId:productA.id, qty:2 }] }, route, sheet, products, routeSales, actor:routeSeller, now:now + 8 });
  routeSales.push(cashSale);
  assert.equal(cashSale.total, 20);
  assert.equal(cashSale.balance, 0);
  assert.throws(() => L.createRouteSale({ input:{ businessId:'biz-alpha', paymentType:'cash', discount:1, items:[{ productId:productA.id, qty:1 }] }, route, sheet, products, routeSales, actor:routeSeller }), /permission_denied:routeSales.discount/, 'route seller cannot discount without a grant');
  const discountedByOwner = L.createRouteSale({ input:{ id:'sale-discount-owner', businessId:'biz-alpha', paymentType:'cash', discount:1, items:[{ productId:productA.id, qty:1 }] }, route, sheet, products, routeSales, actor:owner, now:now + 8.5 });
  assert.equal(discountedByOwner.total, 9, 'owner discount remains explicit and auditable');
  const creditSale = L.createRouteSale({ input:{ id:'sale-credit', businessId:'biz-alpha', customerId:'customer-b', customerName:'Cliente QA B', paymentType:'credit', items:[{ productId:productB.id, qty:1 }] }, route, sheet, products, routeSales, actor:routeSeller, now:now + 9 });
  routeSales.push(creditSale);
  assert.equal(creditSale.total, 5);
  assert.equal(creditSale.balance, 5);
  assert.throws(() => L.createRouteSale({ input:{ businessId:'biz-alpha', paymentType:'cash', items:[{ productId:productA.id, qty:2 }] }, route, sheet, products, routeSales, actor:routeSeller }), /route_inventory_exceeded/, 'route stock cannot be oversold');
  assert.throws(() => L.createRouteSale({ input:{ businessId:'biz-bravo', paymentType:'cash', items:[{ productId:productA.id, qty:1 }] }, route, sheet, products, routeSales, actor:routeSeller }), /cross_business_denied/);
  assert.throws(() => L.createRouteSale({ input:{ businessId:'biz-alpha', paymentType:'cash', items:[{ productId:productA.id, qty:1 }] }, route:{ ...route, id:'route-other' }, sheet, products, routeSales, actor:owner }), /route_sheet_scope_denied/, 'a load sheet cannot be reused by another route');

  let collections = [];
  const firstCollection = L.recordCollection({ input:{ id:'collection-a', businessId:'biz-alpha', amount:3, method:'cash', idempotencyKey:'collect-1' }, route, sale:creditSale, collections, actor:collector, now:now + 10 });
  collections.push(firstCollection.collection);
  assert.equal(firstCollection.noop, false);
  assert.equal(L.remainingCredit(creditSale, collections), 2);
  assert.equal(L.recordCollection({ input:{ id:'collection-repeat', businessId:'biz-alpha', amount:3, method:'cash', idempotencyKey:'collect-1' }, route, sale:creditSale, collections, actor:collector }).noop, true, 'duplicate collection key is a no-op');
  assert.throws(() => L.recordCollection({ input:{ businessId:'biz-alpha', amount:3, method:'cash', idempotencyKey:'collect-over' }, route, sale:creditSale, collections, actor:collector }), /collection_amount_invalid/);
  assert.throws(() => L.recordCollection({ input:{ businessId:'biz-alpha', amount:1, idempotencyKey:'seller-collection' }, route, sale:creditSale, collections, actor:routeSeller }), /permission_denied:collections.write/);
  assert.throws(() => L.recordCollection({ input:{ businessId:'biz-alpha', amount:1, idempotencyKey:'wrong-collector' }, route, sale:creditSale, collections, actor:{ uid:'collector-bravo', roleId:'collector' } }), /route_assignment_denied/);

  let returns = [];
  const sellableReturn = L.recordReturn({ input:{ id:'return-sellable', businessId:'biz-alpha', productId:productA.id, code:productA.code, name:productA.name, qty:1, price:10, condition:'sellable' }, route, sheet, routeSales, returns, actor:routeSeller, now:now + 11 });
  returns.push(sellableReturn);
  const damagedReturn = L.recordReturn({ input:{ id:'return-damaged', businessId:'biz-alpha', productId:productB.id, code:productB.code, name:productB.name, qty:1, price:5, condition:'damaged' }, route, sheet, routeSales, returns, actor:routeSeller, now:now + 12 });
  returns.push(damagedReturn);
  assert.throws(() => L.recordReturn({ input:{ businessId:'biz-alpha', productId:productA.id, qty:1, price:10, condition:'sellable' }, route, sheet, routeSales, returns, actor:routeSeller }), /return_quantity_invalid/);
  assert.throws(() => L.recordReturn({ input:{ businessId:'biz-alpha', productId:productA.id, qty:1, price:10, condition:'sellable' }, route:{ ...route, sellerId:'seller-bravo' }, sheet, routeSales, returns, actor:routeSeller }), /route_assignment_denied/);

  const expenses = [L.recordExpense({ input:{ id:'expense-a', businessId:'biz-alpha', amount:2, category:'Peaje' }, route, actor:owner, now:now + 13 })];
  const shortages = [L.recordVariance({ input:{ id:'shortage-a', businessId:'biz-alpha', type:'shortage', amount:1, note:'Conteo QA' }, route, actor:routeSeller, now:now + 13.1 })];
  const overages = [L.recordVariance({ input:{ id:'overage-a', businessId:'biz-alpha', type:'overage', amount:0.5, note:'Conteo QA' }, route, actor:routeSeller, now:now + 13.2 })];
  assert.equal(shortages[0].type, 'shortage');
  assert.equal(overages[0].type, 'overage');
  assert.throws(() => L.recordExpense({ input:{ businessId:'biz-alpha', amount:1 }, route, actor:routeSeller }), /permission_denied:settlements.write/);
  const settlementDraft = L.createSettlement({ input:{ id:'settlement-a', businessId:'biz-alpha', receivedCash:21 }, route, sheet, routeSales, collections, returns, expenses, shortages, overages, actor:owner, now:now + 14 });
  let settlement = settlementDraft.settlement; route = settlementDraft.route;
  assert.equal(settlement.calculation.expectedCash, 21, 'cash sales plus collections less expenses yields expected cash');
  assert.equal(settlement.difference, 0);
  assert.throws(() => L.approveSettlement({ settlement, actor:routeSeller }), /permission_denied:settlements.approve/);
  // r36: reject/observe -- a pending settlement can be sent back with a
  // required reason instead of only ever being approved; the route returns
  // to in_progress and a fresh createSettlement() supersedes it, but the
  // rejected record itself is never deleted (append-only audit trail).
  assert.throws(() => L.rejectSettlement({ settlement, route, actor:owner }), /reject_reason_required/);
  assert.throws(() => L.rejectSettlement({ settlement, route, reason:'Falta contar efectivo', actor:routeSeller }), /permission_denied:settlements.approve/);
  const rejection = L.rejectSettlement({ settlement, route, reason:'Falta contar efectivo', actor:owner, now:now + 14.5 });
  assert.equal(rejection.settlement.status, 'rejected');
  assert.equal(rejection.settlement.rejectReason, 'Falta contar efectivo');
  assert.equal(rejection.route.status, 'in_progress');
  assert.throws(() => L.approveSettlement({ settlement:rejection.settlement, actor:owner }), /settlement_not_approvable/, 'a rejected settlement cannot be approved directly -- it must be superseded');
  const resubmitted = L.createSettlement({ input:{ id:'settlement-a-v2', businessId:'biz-alpha', receivedCash:21 }, route:rejection.route, sheet, routeSales, collections, returns, expenses, shortages, overages, actor:owner, now:now + 14.6 });
  settlement = resubmitted.settlement; route = resubmitted.route;
  settlement = L.approveSettlement({ settlement, actor:owner, now:now + 15 });
  const closing = L.closeSettlement({ settlement, route, products, returns, actor:owner, now:now + 16 });
  settlement = closing.settlement; route = closing.route; products = closing.products;
  assert.equal(settlement.status, 'closed');
  assert.equal(route.status, 'closed');
  assert.equal(products.find((product) => product.id === productA.id).qty, 8, 'sellable returns restore inventory on close once');
  assert.throws(() => L.closeSettlement({ settlement, route, products, returns, actor:owner }), /settlement_already_closed/);
  const reopened = L.reopenSettlement({ settlement, route, reason:'Corrección QA', actor:owner, now:now + 17 });
  settlement = L.approveSettlement({ settlement:reopened.settlement, actor:owner, now:now + 18 });
  const secondClose = L.closeSettlement({ settlement, route:reopened.route, products, returns, actor:owner, now:now + 19 });
  assert.equal(secondClose.products.find((product) => product.id === productA.id).qty, 8, 'reclose after approved reopen never restores the same stock twice');

  const report = L.logisticsReport({ businessId:'biz-alpha', routes:[route], routeSales, collections, returns, settlements:[secondClose.settlement] });
  assert.equal(report.sales, 25);
  assert.equal(report.collections, 3);
  assert.equal(report.credits, 2);
  assert.equal(report.sellableReturns, 1);
  assert.equal(report.damagedReturns, 1);
  assert.equal(report.bySeller['Vendedor QA'], 25);
  const html = L.printDocument({ kind:'settlement', businessName:'Negocio QA', route, settlement:secondClose.settlement });
  assert.match(html, /LIQUIDACIÓN DE RUTA/);
  assert.doesNotMatch(html, /<script/i);

  console.log('P2 logistics routes and settlement harness: PASS');
})();
