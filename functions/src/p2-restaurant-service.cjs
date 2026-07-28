'use strict';

const { createHash, randomUUID } = require('node:crypto');

const ACTIONS = new Set([
  'createRestaurantOrder',
  'appendRestaurantRound',
  'transitionRestaurantOrder',
  'recordRestaurantPayment',
  'cancelRestaurantOrder',
  'recordRestaurantPrint'
]);
const ORDER_STATES = new Set(['draft', 'sent', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled', 'paid']);
const AREAS = new Set(['kitchen', 'bar']);
const PAYMENT_METHODS = new Set(['Efectivo', 'Tarjeta', 'Transferencia', 'Credito']);
const SAFE_ID = /^[A-Za-z0-9_-]{3,128}$/;

class RestaurantError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
function id(value, label) {
  const clean = String(value || '').trim();
  if (!SAFE_ID.test(clean) || clean === 'demo-click360') throw new RestaurantError('invalid_' + label);
  return clean;
}
function key(value) {
  const clean = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{12,192}$/.test(clean)) throw new RestaurantError('invalid_idempotency_key');
  return clean;
}
function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RestaurantError('invalid_amount');
  return Math.round(number * 100) / 100;
}
function permissionsFor(role) {
  if (role === 'owner' || role === 'admin') return ['orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'sales.create', 'sales.cancel', 'tables.read'];
  if (role === 'server') return ['orders.create', 'orders.update', 'tables.read'];
  if (role === 'kitchen') return ['kitchen.read', 'kitchen.update'];
  if (role === 'cashier') return ['sales.create', 'tables.read'];
  return [];
}
function activeMember(member, uid, businessId) {
  return !!member && member.schemaFamily === 'p2' && member.uid === uid && member.businessId === businessId && member.status === 'active';
}
function permitted(member, permission) {
  return member.roleId === 'owner' || (member.permissions || permissionsFor(member.roleId)).includes(permission);
}
function transitionAllowed(current, next) {
  const graph = {
    draft: ['sent', 'cancelled'],
    sent: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['delivered', 'cancelled'],
    delivered: ['paid', 'cancelled'],
    paid: [],
    cancelled: []
  };
  return Array.isArray(graph[current]) && graph[current].includes(next);
}
function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new RestaurantError('invalid_order_items');
  return items.map((item, index) => {
    const qty = Math.max(1, Math.min(999, Math.trunc(Number(item.qty || 0))));
    const unitPrice = money(item.unitPrice == null ? item.price : item.unitPrice);
    const area = AREAS.has(String(item.area || 'kitchen')) ? String(item.area || 'kitchen') : 'kitchen';
    if (!qty || unitPrice < 0) throw new RestaurantError('invalid_order_item');
    return {
      id: id(item.id || 'line_' + (index + 1), 'line_id'),
      productId: String(item.productId || '').slice(0, 128),
      name: String(item.name || 'Producto').slice(0, 160),
      qty,
      unitPrice,
      total: money(qty * unitPrice),
      area,
      notes: String(item.notes || '').slice(0, 240),
      status: String(item.status || 'draft')
    };
  });
}
function totalFor(items, discount = 0) {
  return Math.max(0, money(items.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + money(item.total), 0) - money(discount)));
}
function publicOrder(order) {
  return {
    id: order.id,
    businessId: order.businessId,
    tableId: order.tableId,
    serverId: order.serverId,
    status: order.status,
    total: order.total,
    paidAmount: order.paidAmount,
    remaining: order.remaining,
    version: order.version
  };
}

function createP2RestaurantService({ db, FieldValue, clock = () => Date.now(), idFactory = randomUUID }) {
  if (!db || !FieldValue) throw new Error('restaurant_dependencies_required');
  function business(businessId) { return db.collection('businesses').doc(businessId); }
  function member(businessId, uid) { return business(businessId).collection('members').doc(uid); }
  function order(businessId, orderId) { return business(businessId).collection('restaurantOrders').doc(orderId); }
  function serverTime() { return FieldValue.serverTimestamp(); }
  async function actor(transaction, businessId, uid, permission) {
    const snapshot = await transaction.get(member(businessId, uid));
    const current = snapshot.exists ? snapshot.data() : null;
    if (!activeMember(current, uid, businessId)) throw new RestaurantError('membership_not_active', 403);
    if (!permitted(current, permission)) throw new RestaurantError('permission_denied:' + permission, 403);
    return current;
  }
  function flagAllows(flag, businessId, uid) {
    const allowedBusinesses = Array.isArray(flag.allowedBusinessIds) ? flag.allowedBusinessIds : [];
    const allowedUids = Array.isArray(flag.allowedUids) ? flag.allowedUids : [];
    if (allowedBusinesses.length && !allowedBusinesses.includes(businessId)) return false;
    if (allowedUids.length && !allowedUids.includes(uid)) return false;
    const percentage = Math.max(0, Math.min(100, Number(flag.rolloutPercentage == null ? 100 : flag.rolloutPercentage)));
    if (percentage >= 100) return true;
    return Number.parseInt(hash(uid + ':' + String(flag.key || 'restaurant')).slice(0, 8), 16) % 100 < percentage;
  }
  async function enabled(transaction, businessId, uid) {
    const snapshot = await transaction.get(business(businessId).collection('featureConfig').doc('main'));
    const config = snapshot.exists ? snapshot.data() || {} : {};
    const flag = config.featureFlags?.restaurantAdvancedEnabled || {};
    if (config.modules?.restaurant !== true || flag.enabled !== true || flag.killSwitch === true || !flagAllows(flag, businessId, uid)) {
      throw new RestaurantError('restaurant_module_disabled', 403);
    }
  }
  function audit(transaction, businessId, uid, action, entityId, requestId) {
    transaction.set(business(businessId).collection('restaurantEvents').doc('event_' + idFactory().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 42)), {
      schemaFamily: 'p2',
      businessId,
      orderId: entityId || '',
      action,
      requestId: requestId || '',
      status: 'applied',
      version: 1,
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTime(),
      updatedAt: serverTime()
    });
  }
  async function transactional({ action, businessId, uid, idempotencyKey, requestId, execute }) {
    const cleanKey = key(idempotencyKey);
    const marker = business(businessId).collection('p2Idempotency').doc(hash('restaurant:' + action + ':' + cleanKey));
    return db.runTransaction(async (transaction) => {
      const prior = await transaction.get(marker);
      if (prior.exists) {
        const data = prior.data() || {};
        if (data.actorUid !== uid || data.action !== action) throw new RestaurantError('idempotency_key_reused', 409);
        return { ...(data.result || {}), noop: true, requestId };
      }
      const outcome = await execute(transaction);
      transaction.set(marker, {
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
      audit(transaction, businessId, uid, action, outcome.orderId || '', requestId);
      return { ...(outcome.result || {}), noop: false, requestId };
    });
  }
  async function run({ action, actorUid, payload = {}, idempotencyKey, requestId = '' }) {
    if (!ACTIONS.has(action)) throw new RestaurantError('unknown_restaurant_action', 404);
    const businessId = id(payload.businessId, 'business_id');
    const uid = id(actorUid, 'actor_uid');
    if (JSON.stringify(payload).length > 50000) throw new RestaurantError('payload_too_large', 413);
    return transactional({
      action, businessId, uid, idempotencyKey, requestId,
      execute: async (transaction) => {
        await enabled(transaction, businessId, uid);
        if (action === 'createRestaurantOrder') {
          await actor(transaction, businessId, uid, 'orders.create');
          const orderId = id(payload.orderId, 'order_id');
          const tableId = id(payload.tableId, 'table_id');
          const ref = order(businessId, orderId);
          const existing = await transaction.get(ref);
          if (existing.exists) return { result: { order: publicOrder(existing.data()) }, orderId };
          const items = normalizeItems(payload.items);
          const total = totalFor(items, payload.discount || 0);
          const data = {
            schemaFamily: 'p2',
            id: orderId,
            businessId,
            tableId,
            serverId: uid,
            status: payload.send === true ? 'sent' : 'draft',
            items: items.map((item) => ({ ...item, status: payload.send === true ? 'sent' : 'draft' })),
            subtotal: total,
            discount: money(payload.discount || 0),
            total,
            paidAmount: 0,
            remaining: total,
            inventoryState: 'pending',
            version: 1,
            createdBy: uid,
            updatedBy: uid,
            createdAt: serverTime(),
            updatedAt: serverTime()
          };
          transaction.create(ref, data);
          return { result: { order: publicOrder(data) }, orderId };
        }
        const orderId = id(payload.orderId, 'order_id');
        const ref = order(businessId, orderId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new RestaurantError('order_not_found', 404);
        const current = snapshot.data() || {};
        if (current.businessId !== businessId) throw new RestaurantError('cross_business_denied', 403);

        if (action === 'appendRestaurantRound') {
          await actor(transaction, businessId, uid, 'orders.update');
          if (['paid', 'cancelled'].includes(current.status)) throw new RestaurantError('order_not_editable', 409);
          const appended = normalizeItems(payload.items);
          const nextItems = [...(current.items || []), ...appended.map((item) => ({ ...item, status: payload.send === true ? 'sent' : 'draft' }))];
          const total = totalFor(nextItems, current.discount || 0);
          const next = {
            ...current,
            items: nextItems,
            status: payload.send === true ? 'sent' : current.status,
            subtotal: total,
            total,
            remaining: money(total - Number(current.paidAmount || 0)),
            version: Number(current.version || 0) + 1,
            updatedBy: uid,
            updatedAt: serverTime()
          };
          transaction.update(ref, next);
          return { result: { order: publicOrder(next) }, orderId };
        }

        if (action === 'transitionRestaurantOrder') {
          await actor(transaction, businessId, uid, 'kitchen.update');
          const nextStatus = String(payload.status || '');
          const area = String(payload.area || '');
          if (!AREAS.has(area) || !ORDER_STATES.has(nextStatus) || !transitionAllowed(current.status, nextStatus)) {
            throw new RestaurantError('invalid_order_transition', 409);
          }
          const next = {
            ...current,
            status: nextStatus,
            kitchenArea: area,
            version: Number(current.version || 0) + 1,
            updatedBy: uid,
            updatedAt: serverTime()
          };
          transaction.update(ref, next);
          return { result: { order: publicOrder(next) }, orderId };
        }

        if (action === 'recordRestaurantPayment') {
          await actor(transaction, businessId, uid, 'sales.create');
          if (['paid', 'cancelled'].includes(current.status)) throw new RestaurantError('order_not_payable', 409);
          const amount = money(payload.amount);
          const method = String(payload.method || '');
          if (!PAYMENT_METHODS.has(method) || amount <= 0 || amount > Number(current.remaining || 0) + 0.00001) {
            throw new RestaurantError('payment_exceeds_balance', 409);
          }
          const paymentId = 'payment_' + hash(idempotencyKey).slice(0, 24);
          const paymentRef = business(businessId).collection('restaurantPayments').doc(paymentId);
          const previousPayment = await transaction.get(paymentRef);
          if (previousPayment.exists) return { result: { order: publicOrder(current), paymentId }, orderId };
          const cashMovementRef = business(businessId).collection('restaurantCashMovements').doc('cash_' + hash(idempotencyKey).slice(0, 24));
          const inventoryRef = business(businessId).collection('restaurantInventoryAdjustments').doc(orderId);
          const saleRef = business(businessId).collection('restaurantSales').doc(orderId);
          const existingCashMovement = await transaction.get(cashMovementRef);
          const existingInventory = await transaction.get(inventoryRef);
          const existingSale = await transaction.get(saleRef);
          if (existingCashMovement.exists || existingInventory.exists && current.status !== 'paid' || existingSale.exists && current.status !== 'paid') {
            throw new RestaurantError('restaurant_financial_ledger_inconsistent', 409);
          }
          const paidAmount = money(Number(current.paidAmount || 0) + amount);
          const remaining = Math.max(0, money(Number(current.total || 0) - paidAmount));
          const paid = remaining === 0;
          const next = {
            ...current,
            paidAmount,
            remaining,
            status: paid ? 'paid' : current.status,
            inventoryState: paid ? 'committed' : current.inventoryState || 'pending',
            paidAt: paid ? serverTime() : current.paidAt || null,
            version: Number(current.version || 0) + 1,
            updatedBy: uid,
            updatedAt: serverTime()
          };
          transaction.create(paymentRef, {
            schemaFamily: 'p2',
            id: paymentId,
            businessId,
            orderId,
            amount,
            method,
            status: 'confirmed',
            idempotencyKey: hash(idempotencyKey),
            version: 1,
            createdBy: uid,
            updatedBy: uid,
            createdAt: serverTime(),
            updatedAt: serverTime()
          });
          transaction.create(cashMovementRef, {
            schemaFamily: 'p2',
            businessId,
            orderId,
            paymentId,
            amount,
            method,
            type: 'restaurant_payment',
            status: 'confirmed',
            idempotencyKey: hash(idempotencyKey),
            version: 1,
            createdBy: uid,
            updatedBy: uid,
            createdAt: serverTime(),
            updatedAt: serverTime()
          });
          if (paid) {
            if (!existingInventory.exists) {
              transaction.create(inventoryRef, {
                schemaFamily: 'p2',
                businessId,
                orderId,
                status: 'committed',
                items: current.items || [],
                version: 1,
                createdBy: uid,
                updatedBy: uid,
                createdAt: serverTime(),
                updatedAt: serverTime()
              });
            }
            if (!existingSale.exists) {
              transaction.create(saleRef, {
                schemaFamily: 'p2',
                id: orderId,
                businessId,
                orderId,
                total: current.total,
                paidAmount,
                status: 'paid',
                version: 1,
                createdBy: uid,
                updatedBy: uid,
                createdAt: serverTime(),
                updatedAt: serverTime()
              });
            }
          }
          transaction.update(ref, next);
          return { result: { order: publicOrder(next), paymentId }, orderId };
        }

        if (action === 'cancelRestaurantOrder') {
          await actor(transaction, businessId, uid, 'orders.cancel');
          if (current.status === 'paid') throw new RestaurantError('paid_order_cancellation_forbidden', 409);
          const next = {
            ...current,
            status: 'cancelled',
            cancellationReason: String(payload.reason || '').slice(0, 240),
            version: Number(current.version || 0) + 1,
            updatedBy: uid,
            updatedAt: serverTime()
          };
          transaction.update(ref, next);
          return { result: { order: publicOrder(next) }, orderId };
        }

        await actor(transaction, businessId, uid, 'tables.read');
        const kind = ['kitchen', 'bar', 'prebill', 'final'].includes(String(payload.kind || '')) ? String(payload.kind) : 'prebill';
        transaction.set(business(businessId).collection('restaurantPrintHistory').doc('print_' + hash(action + ':' + idempotencyKey).slice(0, 24)), {
          schemaFamily: 'p2',
          businessId,
          orderId,
          kind,
          status: 'queued',
          version: 1,
          createdBy: uid,
          updatedBy: uid,
          createdAt: serverTime(),
          updatedAt: serverTime()
        });
        return { result: { order: publicOrder(current), kind }, orderId };
      }
    });
  }
  return Object.freeze({ run });
}

module.exports = {
  ACTIONS,
  RestaurantError,
  createP2RestaurantService,
  transitionAllowed,
  normalizeItems,
  totalFor
};
