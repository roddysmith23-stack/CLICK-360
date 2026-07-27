'use strict';

const { createHash, randomUUID } = require('node:crypto');

const ACTIONS = new Set([
  'createVehicle', 'createRoute', 'assignRoute', 'createLoadSheet', 'confirmLoadSheet',
  'dispatchLoadSheet', 'createRouteSale', 'recordCollection', 'recordReturn',
  'recordRouteExpense', 'createRouteSettlement', 'approveRouteSettlement',
  'closeRouteSettlement', 'reopenRouteSettlement'
]);
const SAFE_ID = /^[A-Za-z0-9_-]{3,128}$/;

class LogisticsError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
function id(value, label) {
  const clean = String(value || '').trim();
  if (!SAFE_ID.test(clean) || clean === 'demo-click360') throw new LogisticsError('invalid_' + label);
  return clean;
}
function key(value) {
  const clean = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{12,192}$/.test(clean)) throw new LogisticsError('invalid_idempotency_key');
  return clean;
}
function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new LogisticsError('invalid_amount');
  return Math.round(number * 100) / 100;
}
function active(member, uid, businessId) {
  return !!member && member.schemaFamily === 'p2' && member.uid === uid && member.businessId === businessId && member.status === 'active';
}
function role(member) { return String(member?.roleId || 'readonly'); }
function requireRouteManager(member) {
  if (!['owner', 'admin'].includes(role(member))) {
    throw new LogisticsError('permission_denied:routes.manage', 403);
  }
}
function permission(member, value) {
  if (['owner', 'admin'].includes(role(member))) return true;
  const permissions = member?.permissions || [];
  return permissions.includes(value);
}
function routeAssigned(route, uid, expected) {
  if (['owner', 'admin'].includes(expected?.roleId || '')) return true;
  if (expected === 'seller') return route.sellerId === uid;
  if (expected === 'collector') return route.collectorId === uid;
  return false;
}
function normaliseLoadItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new LogisticsError('invalid_load_items');
  return items.map((item, index) => {
    const qty = Math.max(1, Math.min(999999, Math.trunc(Number(item.qty || 0))));
    if (!qty) throw new LogisticsError('invalid_load_quantity');
    return {
      productId: id(item.productId || 'product_' + (index + 1), 'product_id'),
      code: String(item.code || '').slice(0, 96),
      name: String(item.name || 'Producto').slice(0, 160),
      qty,
      routePrice: money(item.routePrice == null ? item.price || 0 : item.routePrice),
      soldQty: 0,
      returnedQty: 0
    };
  });
}
function total(items) {
  return money((items || []).reduce((sum, item) => sum + money(Number(item.qty || 0) * Number(item.routePrice || 0)), 0));
}
function publicRoute(route) {
  return {
    id: route.id,
    businessId: route.businessId,
    status: route.status,
    vehicleId: route.vehicleId || '',
    sellerId: route.sellerId || '',
    collectorId: route.collectorId || '',
    version: route.version
  };
}

function createP2LogisticsService({ db, FieldValue, idFactory = randomUUID }) {
  if (!db || !FieldValue) throw new Error('logistics_dependencies_required');
  function business(businessId) { return db.collection('businesses').doc(businessId); }
  function member(businessId, uid) { return business(businessId).collection('members').doc(uid); }
  function routeRef(businessId, routeId) { return business(businessId).collection('routes').doc(routeId); }
  function serverTime() { return FieldValue.serverTimestamp(); }
  async function actor(transaction, businessId, uid, required) {
    const snapshot = await transaction.get(member(businessId, uid));
    const current = snapshot.exists ? snapshot.data() : null;
    if (!active(current, uid, businessId)) throw new LogisticsError('membership_not_active', 403);
    if (required && !permission(current, required)) throw new LogisticsError('permission_denied:' + required, 403);
    return current;
  }
  async function enabled(transaction, businessId) {
    const snapshot = await transaction.get(business(businessId).collection('featureConfig').doc('main'));
    const config = snapshot.exists ? snapshot.data() || {} : {};
    const flag = config.featureFlags?.logisticsEnabled || {};
    if (config.modules?.logistics !== true || flag.enabled !== true || flag.killSwitch === true) {
      throw new LogisticsError('logistics_module_disabled', 403);
    }
  }
  function audit(transaction, businessId, uid, action, routeId, requestId) {
    transaction.set(business(businessId).collection('p2AuditLogs').doc('audit_' + idFactory().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 42)), {
      schemaFamily: 'p2',
      businessId,
      action,
      routeId: routeId || '',
      requestId: requestId || '',
      status: 'applied',
      version: 1,
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTime(),
      updatedAt: serverTime()
    });
  }
  async function transaction({ action, businessId, uid, idempotencyKey, requestId, execute }) {
    const cleanKey = key(idempotencyKey);
    const marker = business(businessId).collection('p2Idempotency').doc(hash('logistics:' + action + ':' + cleanKey));
    return db.runTransaction(async (tx) => {
      const prior = await tx.get(marker);
      if (prior.exists) {
        const data = prior.data() || {};
        if (data.actorUid !== uid || data.action !== action) throw new LogisticsError('idempotency_key_reused', 409);
        return { ...(data.result || {}), noop: true, requestId };
      }
      const outcome = await execute(tx);
      tx.set(marker, {
        schemaFamily: 'p2',
        businessId,
        action,
        actorUid: uid,
        status: 'applied',
        result: outcome.result || {},
        version: 1,
        createdBy: uid,
        updatedBy: uid,
        createdAt: serverTime(),
        updatedAt: serverTime()
      });
      audit(tx, businessId, uid, action, outcome.routeId || '', requestId);
      return { ...(outcome.result || {}), noop: false, requestId };
    });
  }
  async function routeAndActor(tx, businessId, routeId, uid, requiredPermission, assignment) {
    const currentActor = await actor(tx, businessId, uid, requiredPermission);
    const routeSnapshot = await tx.get(routeRef(businessId, routeId));
    if (!routeSnapshot.exists) throw new LogisticsError('route_not_found', 404);
    const currentRoute = routeSnapshot.data() || {};
    if (currentRoute.businessId !== businessId) throw new LogisticsError('cross_business_denied', 403);
    if (assignment && !['owner', 'admin'].includes(role(currentActor)) && !routeAssigned(currentRoute, uid, assignment)) {
      throw new LogisticsError('route_assignment_denied', 403);
    }
    return { currentActor, currentRoute };
  }
  async function run({ action, actorUid, payload = {}, idempotencyKey, requestId = '' }) {
    if (!ACTIONS.has(action)) throw new LogisticsError('unknown_logistics_action', 404);
    const businessId = id(payload.businessId, 'business_id');
    const uid = id(actorUid, 'actor_uid');
    if (JSON.stringify(payload).length > 50000) throw new LogisticsError('payload_too_large', 413);
    return transaction({
      action, businessId, uid, idempotencyKey, requestId,
      execute: async (tx) => {
        await enabled(tx, businessId);
        if (action === 'createVehicle') {
          const currentActor = await actor(tx, businessId, uid, 'routes.write');
          requireRouteManager(currentActor);
          const vehicleId = id(payload.vehicleId, 'vehicle_id');
          const ref = business(businessId).collection('vehicles').doc(vehicleId);
          const existing = await tx.get(ref);
          if (existing.exists) return { result: { vehicleId, status: existing.data().status || 'active' } };
          tx.create(ref, {
            schemaFamily: 'p2', id: vehicleId, businessId, plate: String(payload.plate || '').toUpperCase().slice(0, 24),
            name: String(payload.name || 'Vehículo').slice(0, 120), capacity: Math.max(0, Number(payload.capacity || 0)),
            status: 'active', version: 1, createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          return { result: { vehicleId, status: 'active' } };
        }
        if (action === 'createRoute') {
          const currentActor = await actor(tx, businessId, uid, 'routes.write');
          requireRouteManager(currentActor);
          const routeId = id(payload.routeId, 'route_id');
          const ref = routeRef(businessId, routeId);
          const existing = await tx.get(ref);
          if (existing.exists) return { result: { route: publicRoute(existing.data()) }, routeId };
          if (payload.vehicleId) {
            const vehicle = await tx.get(business(businessId).collection('vehicles').doc(id(payload.vehicleId, 'vehicle_id')));
            if (!vehicle.exists || vehicle.data().businessId !== businessId || vehicle.data().status !== 'active') throw new LogisticsError('vehicle_not_available', 409);
          }
          const data = {
            schemaFamily: 'p2', id: routeId, businessId, name: String(payload.name || 'Ruta').slice(0, 120),
            zone: String(payload.zone || '').slice(0, 120), date: String(payload.date || '').slice(0, 32),
            vehicleId: String(payload.vehicleId || ''), sellerId: '', helperId: '', collectorId: '', status: 'planned',
            totalCashSales: 0, totalCollections: 0, totalExpenses: 0, version: 1,
            createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          };
          tx.create(ref, data);
          return { result: { route: publicRoute(data) }, routeId };
        }
        if (action === 'assignRoute') {
          const routeId = id(payload.routeId, 'route_id');
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write');
          const current = resolved.currentRoute;
          if (role(resolved.currentActor) !== 'owner' && role(resolved.currentActor) !== 'admin') throw new LogisticsError('route_assignment_manage_denied', 403);
          const next = {
            ...current,
            sellerId: payload.sellerId ? id(payload.sellerId, 'seller_uid') : '',
            helperId: payload.helperId ? id(payload.helperId, 'helper_uid') : '',
            collectorId: payload.collectorId ? id(payload.collectorId, 'collector_uid') : '',
            version: Number(current.version || 0) + 1,
            updatedBy: uid, updatedAt: serverTime()
          };
          tx.update(routeRef(businessId, routeId), next);
          return { result: { route: publicRoute(next) }, routeId };
        }
        if (action === 'createLoadSheet') {
          const routeId = id(payload.routeId, 'route_id');
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write');
          requireRouteManager(resolved.currentActor);
          const sheetId = id(payload.loadSheetId, 'load_sheet_id');
          const ref = business(businessId).collection('loadSheets').doc(sheetId);
          const existing = await tx.get(ref);
          if (existing.exists) return { result: { loadSheetId: sheetId, status: existing.data().status }, routeId };
          const data = {
            schemaFamily: 'p2', id: sheetId, businessId, routeId, status: 'draft',
            items: normaliseLoadItems(payload.items), version: 1,
            createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          };
          tx.create(ref, data);
          return { result: { loadSheetId: sheetId, status: data.status }, routeId };
        }
        if (action === 'confirmLoadSheet' || action === 'dispatchLoadSheet') {
          const sheetId = id(payload.loadSheetId, 'load_sheet_id');
          const sheetRef = business(businessId).collection('loadSheets').doc(sheetId);
          const sheetSnapshot = await tx.get(sheetRef);
          if (!sheetSnapshot.exists) throw new LogisticsError('load_sheet_not_found', 404);
          const sheet = sheetSnapshot.data() || {};
          const resolved = await routeAndActor(tx, businessId, id(sheet.routeId, 'route_id'), uid, 'routes.write');
          requireRouteManager(resolved.currentActor);
          if (action === 'confirmLoadSheet') {
            if (sheet.status !== 'draft') throw new LogisticsError('load_sheet_not_draft', 409);
            tx.update(sheetRef, { status: 'confirmed', version: Number(sheet.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
            return { result: { loadSheetId: sheetId, status: 'confirmed' }, routeId: resolved.currentRoute.id };
          }
          if (sheet.status === 'dispatched') return { result: { loadSheetId: sheetId, status: 'dispatched' }, routeId: resolved.currentRoute.id };
          if (sheet.status !== 'confirmed' || resolved.currentRoute.status !== 'planned') throw new LogisticsError('load_sheet_not_dispatchable', 409);
          const reservation = business(businessId).collection('routeInventoryReservations').doc(sheetId);
          const existingReservation = await tx.get(reservation);
          if (!existingReservation.exists) {
            tx.create(reservation, {
              schemaFamily: 'p2', businessId, routeId: resolved.currentRoute.id, loadSheetId: sheetId,
              items: sheet.items || [], status: 'reserved', version: 1,
              createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
            });
          }
          tx.update(sheetRef, { status: 'dispatched', version: Number(sheet.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          tx.update(routeRef(businessId, resolved.currentRoute.id), { status: 'dispatched', version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          return { result: { loadSheetId: sheetId, status: 'dispatched' }, routeId: resolved.currentRoute.id };
        }

        const routeId = id(payload.routeId, 'route_id');
        if (action === 'createRouteSale') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'sales.create', 'seller');
          if (resolved.currentRoute.status !== 'dispatched') throw new LogisticsError('route_not_dispatched', 409);
          const sheetId = id(payload.loadSheetId, 'load_sheet_id');
          const sheetSnapshot = await tx.get(business(businessId).collection('loadSheets').doc(sheetId));
          if (!sheetSnapshot.exists || sheetSnapshot.data().routeId !== routeId || sheetSnapshot.data().status !== 'dispatched') throw new LogisticsError('load_sheet_scope_denied', 403);
          const saleId = id(payload.saleId, 'sale_id');
          const saleRef = business(businessId).collection('routeSales').doc(saleId);
          const prior = await tx.get(saleRef);
          if (prior.exists) return { result: { saleId, balance: prior.data().balance }, routeId };
          const items = normaliseLoadItems(payload.items);
          const sheet = sheetSnapshot.data();
          if (!items.every((item) => (sheet.items || []).some((line) => line.productId === item.productId))) {
            throw new LogisticsError('route_sale_product_not_loaded', 409);
          }
          const nextSheetItems = (sheet.items || []).map((line) => {
            const sold = items.filter((item) => item.productId === line.productId).reduce((sum, item) => sum + item.qty, 0);
            const nextSold = Number(line.soldQty || 0) + sold;
            if (nextSold + Number(line.returnedQty || 0) > Number(line.qty || 0)) throw new LogisticsError('route_inventory_exceeded', 409);
            return { ...line, soldQty: nextSold };
          });
          const saleTotal = total(items);
          const paymentType = ['cash', 'credit'].includes(String(payload.paymentType || 'cash')) ? String(payload.paymentType || 'cash') : 'cash';
          const discount = money(payload.discount || 0);
          if (discount > 0 && !['owner', 'admin'].includes(role(resolved.currentActor))) throw new LogisticsError('permission_denied:routeSales.discount', 403);
          const amount = Math.max(0, money(saleTotal - discount));
          const balance = paymentType === 'credit' ? amount : 0;
          tx.create(saleRef, {
            schemaFamily: 'p2', id: saleId, businessId, routeId, loadSheetId: sheetId,
            customerId: String(payload.customerId || '').slice(0, 128), customerName: String(payload.customerName || '').slice(0, 160),
            items, total: amount, discount, paymentType, balance, collectedAmount: 0, status: paymentType === 'credit' ? 'open' : 'paid',
            version: 1, createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          tx.update(business(businessId).collection('loadSheets').doc(sheetId), { items: nextSheetItems, version: Number(sheet.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          tx.update(routeRef(businessId, routeId), {
            totalCashSales: money(Number(resolved.currentRoute.totalCashSales || 0) + (paymentType === 'cash' ? amount : 0)),
            version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime()
          });
          return { result: { saleId, total: amount, balance }, routeId };
        }
        if (action === 'recordCollection') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'collections.write', 'collector');
          const saleId = id(payload.saleId, 'sale_id');
          const saleRef = business(businessId).collection('routeSales').doc(saleId);
          const saleSnapshot = await tx.get(saleRef);
          if (!saleSnapshot.exists || saleSnapshot.data().routeId !== routeId) throw new LogisticsError('sale_scope_denied', 403);
          const sale = saleSnapshot.data() || {};
          const amount = money(payload.amount);
          if (amount <= 0 || amount > Number(sale.balance || 0) + 0.00001) throw new LogisticsError('collection_amount_invalid', 409);
          const collectionId = 'collection_' + hash(idempotencyKey).slice(0, 24);
          const collectionRef = business(businessId).collection('collections').doc(collectionId);
          const previous = await tx.get(collectionRef);
          if (previous.exists) return { result: { collectionId, balance: sale.balance }, routeId };
          const balance = Math.max(0, money(Number(sale.balance || 0) - amount));
          tx.create(collectionRef, {
            schemaFamily: 'p2', id: collectionId, businessId, routeId, saleId, amount,
            method: String(payload.method || 'cash').slice(0, 40), status: 'confirmed', version: 1,
            createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          tx.update(saleRef, { balance, collectedAmount: money(Number(sale.collectedAmount || 0) + amount), status: balance === 0 ? 'paid' : 'open', version: Number(sale.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          tx.update(routeRef(businessId, routeId), { totalCollections: money(Number(resolved.currentRoute.totalCollections || 0) + amount), version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          return { result: { collectionId, balance }, routeId };
        }
        if (action === 'recordReturn') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write', 'seller');
          const sheetId = id(payload.loadSheetId, 'load_sheet_id');
          const sheetRef = business(businessId).collection('loadSheets').doc(sheetId);
          const sheetSnapshot = await tx.get(sheetRef);
          if (!sheetSnapshot.exists || sheetSnapshot.data().routeId !== routeId) throw new LogisticsError('load_sheet_scope_denied', 403);
          const sheet = sheetSnapshot.data() || {};
          const productId = id(payload.productId, 'product_id');
          const qty = Math.max(1, Math.trunc(Number(payload.qty || 0)));
          const condition = ['sellable', 'damaged'].includes(String(payload.condition || '')) ? String(payload.condition) : '';
          if (!qty || !condition) throw new LogisticsError('invalid_return');
          const nextItems = (sheet.items || []).map((line) => {
            if (line.productId !== productId) return line;
            const nextReturned = Number(line.returnedQty || 0) + qty;
            if (Number(line.soldQty || 0) + nextReturned > Number(line.qty || 0)) throw new LogisticsError('return_quantity_invalid', 409);
            return { ...line, returnedQty: nextReturned };
          });
          if (!(sheet.items || []).some((line) => line.productId === productId)) throw new LogisticsError('return_product_not_loaded', 409);
          const returnId = 'return_' + hash(idempotencyKey).slice(0, 24);
          const returnRef = business(businessId).collection('returns').doc(returnId);
          const previous = await tx.get(returnRef);
          if (previous.exists) return { result: { returnId, status: previous.data().status }, routeId };
          tx.create(returnRef, {
            schemaFamily: 'p2', id: returnId, businessId, routeId, loadSheetId: sheetId, productId, qty, condition,
            status: 'recorded', version: 1, createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          tx.update(sheetRef, { items: nextItems, version: Number(sheet.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          return { result: { returnId, status: 'recorded' }, routeId };
        }
        if (action === 'recordRouteExpense') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write');
          if (!['owner', 'admin'].includes(role(resolved.currentActor))) throw new LogisticsError('permission_denied:settlements.write', 403);
          const amount = money(payload.amount);
          if (amount <= 0) throw new LogisticsError('invalid_expense_amount');
          const expenseId = id(payload.expenseId, 'expense_id');
          const expenseRef = business(businessId).collection('routeExpenses').doc(expenseId);
          const previous = await tx.get(expenseRef);
          if (previous.exists) return { result: { expenseId, status: previous.data().status }, routeId };
          tx.create(expenseRef, {
            schemaFamily: 'p2', id: expenseId, businessId, routeId, amount, category: String(payload.category || 'Otro').slice(0, 80),
            status: 'confirmed', version: 1, createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          tx.update(routeRef(businessId, routeId), { totalExpenses: money(Number(resolved.currentRoute.totalExpenses || 0) + amount), version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          return { result: { expenseId, status: 'confirmed' }, routeId };
        }
        if (action === 'createRouteSettlement') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write');
          if (!['owner', 'admin'].includes(role(resolved.currentActor))) throw new LogisticsError('permission_denied:settlements.write', 403);
          const settlementId = id(payload.settlementId, 'settlement_id');
          const settlementRef = business(businessId).collection('routeSettlements').doc(settlementId);
          const prior = await tx.get(settlementRef);
          if (prior.exists) return { result: { settlementId, status: prior.data().status }, routeId };
          const expected = money(Number(resolved.currentRoute.totalCashSales || 0) + Number(resolved.currentRoute.totalCollections || 0) - Number(resolved.currentRoute.totalExpenses || 0));
          const received = money(payload.receivedCash || 0);
          tx.create(settlementRef, {
            schemaFamily: 'p2', id: settlementId, businessId, routeId, status: 'draft', expectedCash: expected, receivedCash: received,
            difference: money(received - expected), inventoryReturnCommitted: false, version: 1,
            createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
          });
          return { result: { settlementId, status: 'draft', expectedCash: expected }, routeId };
        }
        if (action === 'approveRouteSettlement' || action === 'closeRouteSettlement' || action === 'reopenRouteSettlement') {
          const resolved = await routeAndActor(tx, businessId, routeId, uid, 'routes.write');
          if (!['owner', 'admin'].includes(role(resolved.currentActor))) throw new LogisticsError('permission_denied:settlements.approve', 403);
          const settlementId = id(payload.settlementId, 'settlement_id');
          const settlementRef = business(businessId).collection('routeSettlements').doc(settlementId);
          const settlementSnapshot = await tx.get(settlementRef);
          if (!settlementSnapshot.exists || settlementSnapshot.data().routeId !== routeId) throw new LogisticsError('settlement_scope_denied', 403);
          const settlement = settlementSnapshot.data() || {};
          if (action === 'approveRouteSettlement') {
            if (settlement.status !== 'draft') throw new LogisticsError('settlement_not_draft', 409);
            tx.update(settlementRef, { status: 'approved', approvedBy: uid, approvedAt: serverTime(), version: Number(settlement.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
            return { result: { settlementId, status: 'approved' }, routeId };
          }
          if (action === 'reopenRouteSettlement') {
            if (settlement.status !== 'closed' || !String(payload.reason || '').trim()) throw new LogisticsError('settlement_reopen_denied', 409);
            tx.update(settlementRef, { status: 'draft', reopenedBy: uid, reopenReason: String(payload.reason).slice(0, 240), version: Number(settlement.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
            tx.update(routeRef(businessId, routeId), { status: 'dispatched', version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
            return { result: { settlementId, status: 'draft' }, routeId };
          }
          if (settlement.status === 'closed') return { result: { settlementId, status: 'closed' }, routeId };
          if (settlement.status !== 'approved') throw new LogisticsError('settlement_not_approved', 409);
          const returnLedger = business(businessId).collection('routeInventoryAdjustments').doc(settlementId);
          const priorLedger = await tx.get(returnLedger);
          if (!priorLedger.exists) {
            tx.create(returnLedger, {
              schemaFamily: 'p2', businessId, routeId, settlementId, status: 'committed',
              type: 'sellable_return_restore', version: 1, createdBy: uid, updatedBy: uid, createdAt: serverTime(), updatedAt: serverTime()
            });
          }
          tx.update(settlementRef, { status: 'closed', closedBy: uid, closedAt: serverTime(), inventoryReturnCommitted: true, version: Number(settlement.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          tx.update(routeRef(businessId, routeId), { status: 'closed', version: Number(resolved.currentRoute.version || 0) + 1, updatedBy: uid, updatedAt: serverTime() });
          return { result: { settlementId, status: 'closed' }, routeId };
        }
        throw new LogisticsError('unsupported_logistics_action', 400);
      }
    });
  }
  return Object.freeze({ run });
}

module.exports = {
  ACTIONS,
  LogisticsError,
  createP2LogisticsService,
  normaliseLoadItems,
  total
};
