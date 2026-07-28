(function (root) {
  'use strict';

  const ORDER_STATES = Object.freeze(['draft', 'sent', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled', 'paid']);
  const TABLE_STATES = Object.freeze(['free', 'occupied', 'preparing', 'ready', 'to_charge', 'paid', 'cancelled']);
  const KITCHEN_AREAS = Object.freeze(['kitchen', 'bar']);
  const PAYMENT_METHODS = Object.freeze(['Efectivo', 'Tarjeta', 'Transferencia', 'Credito']);
  const LINE_PROGRESS = Object.freeze({ draft: 0, sent: 1, accepted: 2, preparing: 3, ready: 4, delivered: 5 });
  const PERMISSIONS = Object.freeze(['tables.read', 'tables.write', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.read', 'kitchen.update', 'cash.read', 'cash.open', 'cash.close', 'sales.create', 'sales.cancel', 'reports.read']);

  const TRANSITIONS = Object.freeze({
    draft: ['sent', 'cancelled'],
    sent: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['delivered', 'cancelled'],
    delivered: ['cancelled'],
    cancelled: [],
    paid: []
  });

  function text(value) { return String(value || '').trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function quantity(value) { return Math.max(0, Math.trunc(number(value))); }
  function money(value) { return Math.round(number(value) * 100) / 100; }
  function iso(now = Date.now()) { return new Date(now).toISOString(); }
  function safeId(prefix, value = '') { return `${prefix}_${text(value).replace(/[^a-z0-9]/gi, '').slice(-16) || Math.random().toString(36).slice(2, 14)}`; }
  function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
  function escapeHtml(value) { return text(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

  function rolePermissions(roleId) {
    const role = text(roleId).toLowerCase();
    if (role === 'owner' || role === 'admin') return PERMISSIONS;
    if (role === 'server') return ['tables.read', 'tables.write', 'orders.create', 'orders.update'];
    if (role === 'kitchen') return ['kitchen.read', 'kitchen.update'];
    if (role === 'cashier') return ['tables.read', 'cash.read', 'cash.open', 'cash.close', 'sales.create'];
    return [];
  }
  function hasPermission(actor = {}, permission) {
    const granted = actor.permissions || rolePermissions(actor.roleId || actor.role);
    return granted.includes(permission);
  }
  function assertPermission(actor, permission) {
    if (!hasPermission(actor, permission)) throw new Error(`permission_denied:${permission}`);
  }
  function assertBusinessScope(entity, businessId) {
    if (!entity || text(entity.businessId) !== text(businessId)) throw new Error('cross_business_denied');
    return true;
  }
  function assertOrderEditable(order) {
    if (!order || ['paid', 'cancelled'].includes(order.status)) throw new Error('order_not_editable');
  }
  function normalizeLine(input = {}, now = Date.now()) {
    const area = KITCHEN_AREAS.includes(input.area) ? input.area : 'kitchen';
    const qty = Math.max(1, quantity(input.qty || 1));
    const unitPrice = Math.max(0, money(input.unitPrice == null ? input.price : input.unitPrice));
    return {
      id: text(input.id) || safeId('line', `${input.productId || input.code || input.name}:${now}`),
      productId: text(input.productId || input.id),
      code: text(input.code),
      name: text(input.name || 'Producto'),
      qty,
      unitPrice,
      total: money(qty * unitPrice),
      notes: text(input.notes),
      variant: text(input.variant),
      area,
      priority: ['normal', 'high'].includes(input.priority) ? input.priority : 'normal',
      status: ORDER_STATES.includes(input.status) ? input.status : 'draft',
      createdAt: text(input.createdAt) || iso(now),
      updatedAt: text(input.updatedAt) || iso(now),
      cancelledAt: text(input.cancelledAt),
      cancellationReason: text(input.cancellationReason)
    };
  }
  function activeLines(order = {}) { return (order.items || []).filter((line) => line.status !== 'cancelled'); }
  function statusForLines(lines = [], fallback = 'draft') {
    const active = (lines || []).filter((line) => line.status !== 'cancelled');
    if (!active.length) return fallback;
    if (active.every((line) => line.status === 'delivered')) return 'delivered';
    const earliest = active.reduce((lowest, line) => Math.min(lowest, LINE_PROGRESS[line.status] ?? LINE_PROGRESS.draft), LINE_PROGRESS.delivered);
    return Object.entries(LINE_PROGRESS).find(([, progress]) => progress === earliest)?.[0] || fallback;
  }
  function areaStatusFor(order = {}, area) {
    const scoped = activeLines(order).filter((line) => line.area === area);
    return statusForLines(scoped, 'delivered');
  }
  function orderSubtotal(order = {}) { return money(activeLines(order).reduce((sum, line) => sum + money(line.total), 0)); }
  function orderDiscount(order = {}) { return Math.min(orderSubtotal(order), Math.max(0, money(order.discount))); }
  function orderTotal(order = {}) { return Math.max(0, money(orderSubtotal(order) - orderDiscount(order))); }
  function paymentTotal(order = {}) { return money((order.payments || []).filter((payment) => payment.status !== 'cancelled').reduce((sum, payment) => sum + number(payment.amount), 0)); }
  function remainingBalance(order = {}) { return Math.max(0, money(orderTotal(order) - paymentTotal(order))); }
  function tableStateFor(order) {
    if (!order || order.status === 'paid' || order.status === 'cancelled') return order?.status === 'paid' ? 'paid' : 'free';
    if (remainingBalance(order) > 0 && order.status === 'delivered') return 'to_charge';
    if (order.status === 'ready') return 'ready';
    if (['accepted', 'preparing'].includes(order.status)) return 'preparing';
    return 'occupied';
  }
  function normalizeOrder(input = {}, now = Date.now()) {
    const legacyStatus = input.status === 'open' ? 'draft' : input.status;
    const items = (input.items || []).map((line) => normalizeLine(line, now));
    const order = {
      id: text(input.id) || safeId('order', `${input.businessId}:${input.tableId}:${now}`),
      businessId: text(input.businessId),
      tableId: text(input.tableId),
      serverId: text(input.serverId),
      serverName: text(input.serverName),
      status: ORDER_STATES.includes(legacyStatus) ? legacyStatus : 'draft',
      items,
      payments: Array.isArray(input.payments) ? input.payments.map((payment) => ({ ...payment, amount: money(payment.amount), status: payment.status || 'confirmed' })) : [],
      discount: Math.max(0, money(input.discount)),
      discountReason: text(input.discountReason),
      splitPlan: input.splitPlan || null,
      rounds: Array.isArray(input.rounds) ? input.rounds : [],
      openedAt: text(input.openedAt) || iso(now),
      openedAtMs: number(input.openedAtMs, now),
      sentAt: text(input.sentAt),
      closedAt: text(input.closedAt),
      cancelledAt: text(input.cancelledAt),
      cancellationReason: text(input.cancellationReason),
      movedFromTableId: text(input.movedFromTableId),
      mergedFrom: unique(input.mergedFrom),
      auditTrail: Array.isArray(input.auditTrail) ? input.auditTrail : []
    };
    return withFinancials(order);
  }
  function event(order, type, actor = {}, now = Date.now(), details = {}) {
    return { id: safeId('restaurant_audit', `${type}:${now}`), type: text(type), at: iso(now), actorId: text(actor.uid || actor.id), actorRole: text(actor.roleId || actor.role), details: { ...details } };
  }
  function withFinancials(order) {
    const status = ['paid', 'cancelled'].includes(order.status) ? order.status : statusForLines(order.items, order.status || 'draft');
    const subtotal = orderSubtotal(order);
    const discount = Math.min(subtotal, Math.max(0, money(order.discount)));
    const total = Math.max(0, money(subtotal - discount));
    const paid = paymentTotal(order);
    return { ...order, status, discount, subtotal, total, paid, remaining: Math.max(0, money(total - paid)), tableState: tableStateFor({ ...order, status, discount, subtotal, total, paid }) };
  }
  function createOrder({ businessId, tableId, serverId, serverName, actor, now = Date.now(), id } = {}) {
    assertPermission(actor, 'orders.create');
    if (!text(businessId) || !text(tableId)) throw new Error('invalid_order_context');
    return normalizeOrder({ id, businessId, tableId, serverId: serverId || actor?.uid, serverName, status: 'draft', auditTrail: [event({}, 'order_opened', actor, now, { tableId })] }, now);
  }
  function addLine({ order, line, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'orders.update');
    assertOrderEditable(order);
    const nextLine = normalizeLine(line, now);
    const items = [...(order.items || []), nextLine];
    return withFinancials({ ...order, items, auditTrail: [...(order.auditTrail || []), event(order, 'line_added', actor, now, { lineId: nextLine.id, area: nextLine.area })] });
  }
  function updateLine({ order, lineId, patch = {}, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'orders.update');
    assertOrderEditable(order);
    let found = false;
    const items = (order.items || []).map((line) => {
      if (line.id !== lineId) return line;
      found = true;
      if (line.status === 'cancelled') throw new Error('line_cancelled');
      return normalizeLine({ ...line, ...patch, id: line.id, updatedAt: iso(now) }, now);
    });
    if (!found) throw new Error('line_not_found');
    return withFinancials({ ...order, items, auditTrail: [...(order.auditTrail || []), event(order, 'line_updated', actor, now, { lineId })] });
  }
  function cancelLine({ order, lineId, reason, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'orders.cancel');
    assertOrderEditable(order);
    if (!text(reason)) throw new Error('cancellation_reason_required');
    let found = false;
    const items = (order.items || []).map((line) => {
      if (line.id !== lineId) return line;
      found = true;
      return { ...line, status: 'cancelled', cancelledAt: iso(now), cancellationReason: text(reason), updatedAt: iso(now) };
    });
    if (!found) throw new Error('line_not_found');
    return withFinancials({ ...order, items, auditTrail: [...(order.auditTrail || []), event(order, 'line_cancelled', actor, now, { lineId, reason: text(reason) })] });
  }
  function sendRound({ order, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'orders.update');
    assertOrderEditable(order);
    const unsent = activeLines(order).filter((line) => line.status === 'draft');
    if (!unsent.length) throw new Error('round_empty');
    const round = { id: safeId('round', now), sentAt: iso(now), lineIds: unsent.map((line) => line.id) };
    const items = (order.items || []).map((line) => unsent.some((candidate) => candidate.id === line.id) ? { ...line, status: 'sent', updatedAt: iso(now) } : line);
    return withFinancials({ ...order, items, rounds: [...(order.rounds || []), round], sentAt: iso(now), auditTrail: [...(order.auditTrail || []), event(order, 'round_sent', actor, now, { roundId: round.id, lines: round.lineIds.length })] });
  }
  function transitionOrder({ order, status, actor, now = Date.now(), area } = {}) {
    const target = text(status);
    if (!ORDER_STATES.includes(target)) throw new Error('invalid_order_status');
    assertOrderEditable(order);
    if (target === 'cancelled') {
      if (area) throw new Error('area_cancellation_not_supported');
      assertPermission(actor, 'orders.cancel');
      const items = (order.items || []).map((line) => line.status === 'cancelled' ? line : { ...line, status: 'cancelled', cancelledAt: iso(now), updatedAt: iso(now) });
      return withFinancials({ ...order, status: 'cancelled', items, cancelledAt: iso(now), auditTrail: [...(order.auditTrail || []), event(order, 'order_status_changed', actor, now, { status: target })] });
    }
    if (!['accepted', 'preparing', 'ready', 'delivered'].includes(target)) throw new Error('invalid_order_transition');
    if (!KITCHEN_AREAS.includes(area)) throw new Error('kitchen_area_required');
    assertPermission(actor, 'kitchen.update');
    const previous = ({ accepted: 'sent', preparing: 'accepted', ready: 'preparing', delivered: 'ready' })[target];
    const candidateIds = activeLines(order).filter((line) => line.area === area && line.status === previous).map((line) => line.id);
    if (!candidateIds.length) throw new Error('area_transition_not_available');
    const items = (order.items || []).map((line) => candidateIds.includes(line.id) ? { ...line, status: target, updatedAt: iso(now) } : line);
    return withFinancials({ ...order, items, auditTrail: [...(order.auditTrail || []), event(order, 'order_status_changed', actor, now, { status: target, area: text(area), lineCount: candidateIds.length })] });
  }
  function moveOrder({ order, tableId, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'tables.write');
    assertOrderEditable(order);
    if (!text(tableId) || text(tableId) === text(order.tableId)) throw new Error('invalid_table_move');
    return withFinancials({ ...order, movedFromTableId: order.tableId, tableId: text(tableId), auditTrail: [...(order.auditTrail || []), event(order, 'order_moved', actor, now, { from: order.tableId, to: text(tableId) })] });
  }
  function mergeOrders({ target, source, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'tables.write');
    assertBusinessScope(source, target.businessId);
    if (target.id === source.id) throw new Error('merge_same_order');
    if (paymentTotal(target) > 0 || paymentTotal(source) > 0) throw new Error('merge_paid_order_forbidden');
    assertOrderEditable(target);
    assertOrderEditable(source);
    const merged = withFinancials({ ...target, items: [...(target.items || []), ...(source.items || [])], mergedFrom: unique([...(target.mergedFrom || []), source.id]), auditTrail: [...(target.auditTrail || []), event(target, 'orders_merged', actor, now, { sourceOrderId: source.id })] });
    const archived = withFinancials({ ...source, status: 'cancelled', cancelledAt: iso(now), cancellationReason: `merged_into:${target.id}`, auditTrail: [...(source.auditTrail || []), event(source, 'order_merged_into', actor, now, { targetOrderId: target.id })] });
    return { target: merged, source: archived };
  }
  function splitOrder({ order, mode, parts, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'orders.update');
    assertOrderEditable(order);
    const count = Math.max(2, quantity(parts));
    const normalizedMode = ['product', 'quantity', 'person'].includes(mode) ? mode : 'person';
    const groups = Array.from({ length: count }, (_, index) => ({ index: index + 1, amount: 0, lineIds: [], items: [] }));
    const lines = activeLines(order);
    if (normalizedMode === 'person') {
      const cents = Math.round(orderTotal(order) * 100);
      const base = Math.floor(cents / count);
      const remainder = cents - base * count;
      groups.forEach((group, index) => { group.amount = (base + (index < remainder ? 1 : 0)) / 100; group.lineIds = lines.map((line) => line.id); });
    } else if (normalizedMode === 'quantity') {
      let cursor = 0;
      lines.forEach((line) => {
        const unit = money(line.total / Math.max(1, line.qty));
        for (let unitIndex = 0; unitIndex < line.qty; unitIndex += 1) {
          const group = groups[cursor % groups.length];
          group.amount = money(group.amount + unit);
          group.lineIds.push(line.id);
          group.items.push({ lineId: line.id, qty: 1, amount: unit });
          cursor += 1;
        }
      });
    } else {
      lines.forEach((line, lineIndex) => {
        const group = groups[lineIndex % groups.length];
        group.amount = money(group.amount + line.total);
        group.lineIds.push(line.id);
        group.items.push({ lineId: line.id, qty: line.qty, amount: line.total });
      });
    }
    const targetCents = Math.round(orderTotal(order) * 100);
    let delta = targetCents - groups.reduce((sum, group) => sum + Math.round(group.amount * 100), 0);
    for (let index = 0; delta !== 0 && groups.length; index = (index + 1) % groups.length) {
      const adjustment = delta > 0 ? 0.01 : -0.01;
      if (groups[index].amount + adjustment < 0) continue;
      groups[index].amount = money(groups[index].amount + adjustment);
      delta += delta > 0 ? -1 : 1;
    }
    const plan = { id: safeId('split', now), mode: normalizedMode, parts: count, groups, createdAt: iso(now) };
    return withFinancials({ ...order, splitPlan: plan, auditTrail: [...(order.auditTrail || []), event(order, 'bill_split_created', actor, now, { mode: normalizedMode, parts: count })] });
  }
  function applyDiscount({ order, amount, reason, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'sales.cancel');
    assertOrderEditable(order);
    if (!text(reason)) throw new Error('discount_reason_required');
    const value = money(amount);
    if (value < 0 || value > orderSubtotal(order) + 0.00001) throw new Error('invalid_discount_amount');
    return withFinancials({ ...order, discount:value, discountReason:text(reason), auditTrail:[...(order.auditTrail || []), event(order, 'discount_applied', actor, now, { amount:value, reason:text(reason) })] });
  }
  function recordPayment({ order, amount, method, actor, idempotencyKey, now = Date.now(), note = '' } = {}) {
    assertPermission(actor, 'sales.create');
    assertOrderEditable(order);
    const key = text(idempotencyKey);
    if (!key) throw new Error('payment_idempotency_required');
    const existing = (order.payments || []).find((payment) => payment.idempotencyKey === key);
    if (existing) return { order: withFinancials(order), payment: existing, noop: true };
    const value = money(amount);
    if (!PAYMENT_METHODS.includes(method)) throw new Error('invalid_payment_method');
    if (value <= 0) throw new Error('invalid_payment_amount');
    const remaining = remainingBalance(order);
    if (value > remaining + 0.00001) throw new Error('payment_exceeds_balance');
    const payment = { id: safeId('payment', key), idempotencyKey: key, amount: value, method, note: text(note), status: 'confirmed', createdAt: iso(now), createdBy: text(actor.uid || actor.id) };
    const candidate = withFinancials({ ...order, payments: [...(order.payments || []), payment], auditTrail: [...(order.auditTrail || []), event(order, 'payment_recorded', actor, now, { paymentId: payment.id, amount: value, method })] });
    return { order: candidate, payment, noop: false };
  }
  function finalizePayment({ order, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'sales.create');
    if (remainingBalance(order) > 0) throw new Error('balance_remaining');
    if (!activeLines(order).length) throw new Error('order_empty');
    return withFinancials({ ...order, status: 'paid', closedAt: iso(now), auditTrail: [...(order.auditTrail || []), event(order, 'order_paid', actor, now, { paid: paymentTotal(order) })] });
  }
  function kitchenQueue(orders = [], { businessId, area, now = Date.now() } = {}) {
    const selectedArea = KITCHEN_AREAS.includes(area) ? area : 'kitchen';
    return orders.filter((order) => text(order.businessId) === text(businessId) && !['paid', 'cancelled', 'draft'].includes(order.status))
      .map((order) => ({ ...withFinancials(order), areaStatus: areaStatusFor(order, selectedArea), items: activeLines(order).filter((line) => line.area === selectedArea && ['sent', 'accepted', 'preparing', 'ready'].includes(line.status)), elapsedMinutes: Math.max(0, Math.floor((now - number(order.openedAtMs, now)) / 60000)) }))
      .filter((order) => order.items.length)
      .sort((a, b) => number(a.openedAtMs) - number(b.openedAtMs));
  }
  function restaurantReport(orders = [], { businessId } = {}) {
    const scoped = orders.filter((order) => text(order.businessId) === text(businessId));
    const paid = scoped.filter((order) => order.status === 'paid');
    const cancelled = scoped.filter((order) => order.status === 'cancelled');
    const open = scoped.filter((order) => !['paid', 'cancelled'].includes(order.status));
    const productTotals = new Map();
    paid.flatMap((order) => activeLines(order)).forEach((line) => productTotals.set(line.name, money((productTotals.get(line.name) || 0) + line.total)));
    const bestProduct = [...productTotals.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const cookingOrders = paid.filter((order) => order.sentAt && order.closedAt);
    const averageKitchenMinutes = cookingOrders.length ? Math.round(cookingOrders.reduce((sum, order) => sum + Math.max(0, (Date.parse(order.closedAt) - Date.parse(order.sentAt)) / 60000), 0) / cookingOrders.length) : 0;
    const salesByTable = {};
    const salesByServer = {};
    const cashByMethod = {};
    paid.forEach((order) => {
      const total = orderTotal(order);
      salesByTable[order.tableId] = money((salesByTable[order.tableId] || 0) + total);
      const server = order.serverName || 'Sin mesero';
      salesByServer[server] = money((salesByServer[server] || 0) + total);
      (order.payments || []).filter((payment) => payment.status !== 'cancelled').forEach((payment) => { cashByMethod[payment.method] = money((cashByMethod[payment.method] || 0) + number(payment.amount)); });
    });
    return { totalOrders: scoped.length, openOrders: open.length, paidOrders: paid.length, cancelledOrders: cancelled.length, sales: money(paid.reduce((sum, order) => sum + orderTotal(order), 0)), discounts: money(paid.reduce((sum, order) => sum + orderDiscount(order), 0)), openBalance: money(open.reduce((sum, order) => sum + remainingBalance(order), 0)), bestProduct: { name: bestProduct[0], sales: bestProduct[1] }, averageKitchenMinutes, salesByTable, salesByServer, cashByMethod };
  }
  function printDocument({ order, businessName, kind = 'kitchen', area } = {}) {
    const title = kind === 'prebill' ? 'PRECUENTA' : kind === 'final' ? 'CUENTA FINAL' : area === 'bar' ? 'COMANDA BARRA' : 'COMANDA COCINA';
    const lines = activeLines(order).filter((line) => !area || line.area === area);
    const discount = orderDiscount(order);
    return `<article class="restaurantPrint"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(businessName)} · Mesa ${escapeHtml(order.tableId)}</p><p>Comanda ${escapeHtml(order.id.slice(-6).toUpperCase())}</p><ul>${lines.map((line) => `<li><b>${line.qty} x ${escapeHtml(line.name)}</b>${line.notes ? `<small>${escapeHtml(line.notes)}</small>` : ''}</li>`).join('')}</ul>${discount ? `<p>Descuento: -${discount.toFixed(2)}</p>` : ''}<strong>Total: ${orderTotal(order).toFixed(2)}</strong></article>`;
  }

  root.CLICK360_P2_RESTAURANT = Object.freeze({
    ORDER_STATES, TABLE_STATES, KITCHEN_AREAS, PAYMENT_METHODS, PERMISSIONS, TRANSITIONS, LINE_PROGRESS,
    rolePermissions, hasPermission, assertBusinessScope, normalizeLine, normalizeOrder, activeLines,
    statusForLines, areaStatusFor, orderSubtotal, orderDiscount, orderTotal, paymentTotal, remainingBalance, tableStateFor, createOrder, addLine, updateLine,
    cancelLine, sendRound, transitionOrder, moveOrder, mergeOrders, splitOrder, applyDiscount, recordPayment,
    finalizePayment, kitchenQueue, restaurantReport, printDocument
  });
})(typeof window !== 'undefined' ? window : globalThis);
