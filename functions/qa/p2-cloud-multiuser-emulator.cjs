'use strict';

const assert = require('node:assert/strict');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || 'demo-click360-p2-staging';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const origin = 'http://127.0.0.1:5001/' + projectId + '/us-central1';
if (!getApps().length) initializeApp({ projectId });

const rolePermissions = Object.freeze({
  owner: ['business.read', 'business.manage', 'inventory.read', 'inventory.write', 'sales.create', 'sales.read', 'sales.cancel', 'cash.open', 'cash.close', 'cash.read', 'reports.read', 'labels.read', 'labels.write', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'routes.read', 'routes.write', 'collections.read', 'collections.write', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
  admin: ['business.read', 'inventory.read', 'inventory.write', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'routes.read', 'routes.write', 'collections.read', 'collections.write', 'members.read', 'members.manage', 'settings.read', 'settings.manage'],
  cashier: ['business.read', 'sales.create', 'sales.read', 'cash.open', 'cash.close', 'cash.read'],
  server: ['business.read', 'tables.read', 'tables.write', 'orders.create', 'orders.update'],
  kitchen: ['business.read', 'kitchen.read', 'kitchen.update'],
  routeSeller: ['business.read', 'routes.read', 'routes.write', 'sales.create', 'sales.read'],
  collector: ['business.read', 'collections.read', 'collections.write'],
  readonly: ['business.read', 'inventory.read', 'sales.read', 'reports.read', 'cash.read', 'labels.read', 'tables.read', 'routes.read', 'collections.read', 'settings.read']
});

async function token(uid, email) {
  try { await getAuth().createUser({ uid, email }); } catch (error) {
    if (error.code !== 'auth/uid-already-exists' && error.code !== 'auth/email-already-exists') throw error;
  }
  const customToken = await getAuth().createCustomToken(uid);
  const response = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json();
  if (!response.ok) throw new Error('auth_emulator_token_failed:' + JSON.stringify(body));
  return body.idToken;
}

async function call(action, bearer, payload, idempotencyKey) {
  const response = await fetch(origin + '/' + action, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ payload, idempotencyKey })
  });
  const body = await response.json();
  return { status: response.status, body };
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, label + ':' + JSON.stringify(result.body));
  return result.body.result;
}

async function seedMember(db, businessId, uid, roleId, status = 'active') {
  await db.collection('businesses').doc(businessId).collection('members').doc(uid).set({
    schemaFamily: 'p2', uid, businessId, roleId, permissions: rolePermissions[roleId] || [], status,
    version: 1, createdBy: 'p2-fixture', updatedBy: 'p2-fixture', createdAt: new Date(), updatedAt: new Date()
  });
}

async function seedBusiness(db, businessId) {
  await db.collection('businesses').doc(businessId).set({
    schemaFamily: 'p2', businessId, status: 'active', version: 1,
    createdBy: 'p2-fixture', updatedBy: 'p2-fixture', createdAt: new Date(), updatedAt: new Date()
  });
}

async function main() {
  const db = getFirestore();
  const alpha = 'biz-multi-alpha';
  const beta = 'biz-multi-beta';
  await seedBusiness(db, alpha);
  await seedBusiness(db, beta);

  const members = [
    ['owner-alpha', 'owner'], ['admin-alpha', 'admin'], ['cashier-alpha', 'cashier'],
    ['server-alpha', 'server'], ['kitchen-alpha', 'kitchen'], ['route-seller-alpha', 'routeSeller'],
    ['collector-alpha', 'collector'], ['readonly-alpha', 'readonly'], ['revoked-alpha', 'server']
  ];
  for (const [uid, roleId] of members) await seedMember(db, alpha, uid, roleId, uid === 'revoked-alpha' ? 'revoked' : 'active');
  await seedMember(db, beta, 'owner-beta', 'owner');

  const tokens = {};
  for (const [uid] of members) tokens[uid] = await token(uid, uid + '@p2-qa.invalid');
  tokens['owner-beta'] = await token('owner-beta', 'owner-beta@p2-qa.invalid');

  const modules = await call('updateBusinessModules', tokens['owner-alpha'], {
    businessId: alpha,
    modules: { workers: true, restaurant: true, logistics: true },
    featureFlags: {
      workerAccessEnabled: { enabled: true, allowedUids: [], rolloutPercentage: 100 },
      restaurantAdvancedEnabled: { enabled: true, allowedUids: [], rolloutPercentage: 100 },
      logisticsEnabled: { enabled: true, allowedUids: [], rolloutPercentage: 100 }
    }
  }, 'multi_modules_0001');
  expectStatus(modules, 200, 'owner enables scoped modules');

  const invite = await call('inviteWorker', tokens['owner-alpha'], { businessId: alpha, email: 'invitee@p2-qa.invalid', roleId: 'server' }, 'multi_invite_0001');
  const inviteResult = expectStatus(invite, 200, 'owner creates invitation');
  const inviteToken = await token('invitee-alpha', 'invitee@p2-qa.invalid');
  const accepted = await call('acceptInvitation', inviteToken, { businessId: alpha, invitationId: inviteResult.invitationId, token: inviteResult.invitationToken }, 'multi_accept_0001');
  expectStatus(accepted, 200, 'synthetic worker accepts exact invitation');

  const createOrder = await call('createRestaurantOrder', tokens['server-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', tableId: 'table-alpha-001', send: true,
    items: [{ id: 'line-alpha-001', productId: 'product-alpha', name: 'Producto QA', qty: 2, unitPrice: 10, area: 'kitchen' }]
  }, 'multi_order_0001');
  expectStatus(createOrder, 200, 'server creates order');
  for (const status of ['accepted', 'preparing', 'ready']) {
    expectStatus(await call('transitionRestaurantOrder', tokens['kitchen-alpha'], {
      businessId: alpha, orderId: 'order-alpha-001', area: 'kitchen', status
    }, 'multi_kitchen_' + status + '_001'), 200, 'kitchen transition ' + status);
  }
  expectStatus(await call('transitionRestaurantOrder', tokens['owner-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', area: 'kitchen', status: 'delivered'
  }, 'multi_delivered_0001'), 200, 'owner delivers order');

  expectStatus(await call('recordRestaurantPayment', tokens['cashier-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', amount: 5, method: 'Efectivo'
  }, 'multi_payment_part_001'), 200, 'cashier records partial payment');
  const finalPayment = await call('recordRestaurantPayment', tokens['cashier-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', amount: 15, method: 'Tarjeta'
  }, 'multi_payment_final_001');
  expectStatus(finalPayment, 200, 'cashier records final payment');
  const duplicateFinal = await call('recordRestaurantPayment', tokens['cashier-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', amount: 15, method: 'Tarjeta'
  }, 'multi_payment_final_001');
  assert.equal(expectStatus(duplicateFinal, 200, 'duplicate payment is idempotent').noop, true);
  const order = await db.collection('businesses').doc(alpha).collection('restaurantOrders').doc('order-alpha-001').get();
  assert.equal(order.data().status, 'paid');
  assert.equal(order.data().paidAmount, 20);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantPayments').get()).size, 2);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantCashMovements').get()).size, 2);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantSales').get()).size, 1);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantInventoryAdjustments').get()).size, 1);

  expectStatus(await call('createRestaurantOrder', tokens['server-alpha'], {
    businessId: alpha, orderId: 'order-alpha-concurrent', tableId: 'table-alpha-concurrent', send: true,
    items: [{ id: 'line-alpha-concurrent', productId: 'product-alpha', name: 'Producto QA', qty: 1, unitPrice: 20, area: 'kitchen' }]
  }, 'multi_concurrent_order_001'), 200, 'server creates concurrent payment order');
  for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
    expectStatus(await call('transitionRestaurantOrder', tokens['owner-alpha'], {
      businessId: alpha, orderId: 'order-alpha-concurrent', area: 'kitchen', status
    }, 'multi_concurrent_kitchen_' + status + '_001'), 200, 'owner prepares concurrent order ' + status);
  }
  const [concurrentPaymentA, concurrentPaymentB] = await Promise.all([
    call('recordRestaurantPayment', tokens['cashier-alpha'], {
      businessId: alpha, orderId: 'order-alpha-concurrent', amount: 20, method: 'Efectivo'
    }, 'multi_concurrent_payment_a_001'),
    call('recordRestaurantPayment', tokens['cashier-alpha'], {
      businessId: alpha, orderId: 'order-alpha-concurrent', amount: 20, method: 'Tarjeta'
    }, 'multi_concurrent_payment_b_001')
  ]);
  const concurrentStatuses = [concurrentPaymentA.status, concurrentPaymentB.status].sort();
  assert.deepEqual(concurrentStatuses, [200, 409], 'only one distinct concurrent restaurant payment can settle an order');
  const concurrentOrder = await db.collection('businesses').doc(alpha).collection('restaurantOrders').doc('order-alpha-concurrent').get();
  assert.equal(concurrentOrder.data().status, 'paid');
  assert.equal(concurrentOrder.data().paidAmount, 20);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantPayments').get()).size, 3);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantCashMovements').get()).size, 3);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantSales').get()).size, 2);
  assert.equal((await db.collection('businesses').doc(alpha).collection('restaurantInventoryAdjustments').get()).size, 2);

  expectStatus(await call('createVehicle', tokens['owner-alpha'], {
    businessId: alpha, vehicleId: 'vehicle-alpha-001', plate: 'QA-001', name: 'Vehiculo QA', capacity: 100
  }, 'multi_vehicle_0001'), 200, 'owner creates vehicle');
  expectStatus(await call('createRoute', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', vehicleId: 'vehicle-alpha-001', name: 'Ruta QA', date: '2026-07-27'
  }, 'multi_route_0001'), 200, 'owner creates route');
  expectStatus(await call('assignRoute', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', sellerId: 'route-seller-alpha', collectorId: 'collector-alpha'
  }, 'multi_assign_0001'), 200, 'owner assigns seller and collector');
  expectStatus(await call('createLoadSheet', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001',
    items: [{ productId: 'product-alpha', name: 'Producto QA', qty: 10, price: 4 }]
  }, 'multi_sheet_0001'), 200, 'owner creates load sheet');
  expectStatus(await call('confirmLoadSheet', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001'
  }, 'multi_confirm_0001'), 200, 'owner confirms load sheet');
  expectStatus(await call('dispatchLoadSheet', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001'
  }, 'multi_dispatch_0001'), 200, 'owner dispatches one reservation');
  expectStatus(await call('createRouteSale', tokens['route-seller-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001', saleId: 'sale-alpha-cash', paymentType: 'cash',
    items: [{ productId: 'product-alpha', name: 'Producto QA', qty: 2, price: 4 }]
  }, 'multi_sale_cash_001'), 200, 'assigned route seller records cash sale');
  const creditSale = expectStatus(await call('createRouteSale', tokens['route-seller-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001', saleId: 'sale-alpha-credit', paymentType: 'credit',
    items: [{ productId: 'product-alpha', name: 'Producto QA', qty: 1, price: 4 }]
  }, 'multi_sale_credit_001'), 200, 'assigned route seller records credit sale');
  assert.equal(creditSale.balance, 4);
  const [concurrentCollectionA, concurrentCollectionB] = await Promise.all([
    call('recordCollection', tokens['collector-alpha'], {
      businessId: alpha, routeId: 'route-alpha-001', saleId: 'sale-alpha-credit', amount: 4, method: 'Efectivo'
    }, 'multi_collection_concurrent_a_001'),
    call('recordCollection', tokens['collector-alpha'], {
      businessId: alpha, routeId: 'route-alpha-001', saleId: 'sale-alpha-credit', amount: 4, method: 'Efectivo'
    }, 'multi_collection_concurrent_b_001')
  ]);
  const collectionStatuses = [concurrentCollectionA.status, concurrentCollectionB.status].sort();
  assert.deepEqual(collectionStatuses, [200, 409], 'only one distinct concurrent collection can consume a credit balance');
  assert.equal((await db.collection('businesses').doc(alpha).collection('collections').get()).size, 1);
  expectStatus(await call('recordReturn', tokens['route-seller-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', loadSheetId: 'sheet-alpha-001', productId: 'product-alpha', qty: 1, condition: 'sellable'
  }, 'multi_return_001'), 200, 'assigned route seller records return');
  expectStatus(await call('recordRouteExpense', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', expenseId: 'expense-alpha-001', amount: 1, category: 'Peaje'
  }, 'multi_expense_001'), 200, 'owner records route expense');
  const settlement = expectStatus(await call('createRouteSettlement', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', settlementId: 'settlement-alpha-001', receivedCash: 11
  }, 'multi_settlement_001'), 200, 'owner creates settlement');
  assert.equal(settlement.expectedCash, 11);
  expectStatus(await call('approveRouteSettlement', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', settlementId: 'settlement-alpha-001'
  }, 'multi_settlement_approve_001'), 200, 'owner approves settlement');
  expectStatus(await call('closeRouteSettlement', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', settlementId: 'settlement-alpha-001'
  }, 'multi_settlement_close_001'), 200, 'owner closes settlement');
  expectStatus(await call('closeRouteSettlement', tokens['owner-alpha'], {
    businessId: alpha, routeId: 'route-alpha-001', settlementId: 'settlement-alpha-001'
  }, 'multi_settlement_close_002'), 200, 'second close is safe');
  assert.equal((await db.collection('businesses').doc(alpha).collection('routeInventoryReservations').get()).size, 1);
  assert.equal((await db.collection('businesses').doc(alpha).collection('routeInventoryAdjustments').get()).size, 1);
  assert.equal((await db.collection('businesses').doc(alpha).collection('routeCashMovements').get()).size, 3);
  const returnAdjustment = await db.collection('businesses').doc(alpha).collection('routeInventoryAdjustments').doc('settlement-alpha-001').get();
  assert.equal(returnAdjustment.data().totalQty, 1);
  assert.deepEqual(returnAdjustment.data().items, [{ returnId: 'return_' + require('node:crypto').createHash('sha256').update('multi_return_001').digest('hex').slice(0, 24), productId: 'product-alpha', qty: 1, condition: 'sellable' }]);

  const deniedBusiness = await call('createRestaurantOrder', tokens['owner-beta'], {
    businessId: alpha, orderId: 'order-cross-001', tableId: 'table-cross-001', items: [{ id: 'line-cross-001', qty: 1, price: 1 }]
  }, 'multi_cross_business_001');
  assert.equal(deniedBusiness.status, 403);
  assert.equal(deniedBusiness.body.code, 'membership_not_active');
  const deniedRole = await call('recordRestaurantPayment', tokens['server-alpha'], {
    businessId: alpha, orderId: 'order-alpha-001', amount: 1, method: 'Efectivo'
  }, 'multi_server_cash_denied');
  assert.equal(deniedRole.status, 403);
  assert.equal(deniedRole.body.code, 'permission_denied:sales.create');
  const readonlyDenied = await call('createRoute', tokens['readonly-alpha'], {
    businessId: alpha, routeId: 'route-readonly-001', name: 'No permitida'
  }, 'multi_readonly_denied');
  assert.equal(readonlyDenied.status, 403);

  expectStatus(await call('revokeWorker', tokens['owner-alpha'], { businessId: alpha, targetUid: 'server-alpha' }, 'multi_revoke_server_001'), 200, 'owner revokes worker');
  const revokedDenied = await call('createRestaurantOrder', tokens['server-alpha'], {
    businessId: alpha, orderId: 'order-revoked-001', tableId: 'table-revoked-001', items: [{ id: 'line-revoked-001', qty: 1, price: 1 }]
  }, 'multi_revoked_denied');
  assert.equal(revokedDenied.status, 403);
  assert.equal(revokedDenied.body.code, 'membership_not_active');

  assert.equal((await db.collection('businesses').doc(beta).collection('restaurantOrders').get()).size, 0);
  console.log('P2 cloud multiuser Auth/Functions/Firestore emulator: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
