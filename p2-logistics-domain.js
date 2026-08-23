(function (root) {
  'use strict';

  const ROUTE_STATUS = Object.freeze(['draft', 'planned', 'dispatched', 'in_progress', 'settlement_pending', 'closed', 'cancelled']);
  const LOAD_SHEET_STATUS = Object.freeze(['draft', 'confirmed', 'dispatched', 'closed', 'cancelled']);
  const SETTLEMENT_STATUS = Object.freeze(['draft', 'pending_approval', 'approved', 'rejected', 'closed', 'reopened', 'cancelled']);
  const PAYMENT_TYPES = Object.freeze(['cash', 'credit', 'transfer']);
  const RETURN_CONDITIONS = Object.freeze(['sellable', 'damaged']);
  const PERMISSIONS = Object.freeze([
    'vehicles.read', 'vehicles.write', 'routes.read', 'routes.write', 'routes.assign',
    'loadSheets.read', 'loadSheets.write', 'routeSales.read', 'routeSales.create', 'routeSales.discount', 'routeSales.cancel',
    'collections.read', 'collections.write', 'returns.read', 'returns.write',
    'settlements.read', 'settlements.write', 'settlements.approve', 'settlements.reopen',
    'reports.read', 'printing.write'
  ]);

  function text(value) { return String(value || '').trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function quantity(value) { return Math.max(0, Math.trunc(number(value))); }
  function money(value) { return Math.round(number(value) * 100) / 100; }
  function iso(now = Date.now()) { return new Date(now).toISOString(); }
  function safeId(prefix, value = '') { return `${prefix}_${text(value).replace(/[^a-z0-9]/gi, '').slice(-20) || Math.random().toString(36).slice(2, 14)}`; }
  function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
  function escapeHtml(value) { return text(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }

  function rolePermissions(roleId) {
    const role = text(roleId).toLowerCase();
    if (role === 'owner' || role === 'admin') return PERMISSIONS;
    if (role === 'inventory') return ['vehicles.read', 'routes.read', 'loadSheets.read', 'loadSheets.write', 'returns.read', 'returns.write', 'reports.read', 'printing.write'];
    if (role === 'routeseller') return ['routes.read', 'loadSheets.read', 'routeSales.read', 'routeSales.create', 'returns.read', 'returns.write', 'settlements.read', 'printing.write'];
    if (role === 'collector') return ['routes.read', 'routeSales.read', 'collections.read', 'collections.write', 'settlements.read'];
    if (role === 'readonly') return ['routes.read', 'loadSheets.read', 'routeSales.read', 'collections.read', 'returns.read', 'settlements.read', 'reports.read'];
    return [];
  }
  function hasPermission(actor = {}, permission) {
    const granted = Array.isArray(actor.permissions) ? actor.permissions : rolePermissions(actor.roleId || actor.role);
    return granted.includes(permission);
  }
  function assertPermission(actor, permission) {
    if (!hasPermission(actor, permission)) throw new Error(`permission_denied:${permission}`);
  }
  function assertBusinessScope(entity, businessId) {
    if (!entity || text(entity.businessId) !== text(businessId)) throw new Error('cross_business_denied');
    return true;
  }
  function actorRole(actor = {}) { return text(actor.roleId || actor.role).toLowerCase(); }
  function isRoutePrivileged(actor = {}) { return ['owner', 'admin'].includes(actorRole(actor)); }
  function canAccessRoute(route, actor = {}, scope = 'read') {
    if (!route) return false;
    if (isRoutePrivileged(actor)) return true;
    const uid = text(actor.uid || actor.id);
    const role = actorRole(actor);
    if (!uid) return false;
    if (role === 'routeseller') return text(route.sellerId) === uid;
    if (role === 'collector') return text(route.collectorId) === uid;
    if (scope === 'read') return hasPermission(actor, 'routes.read');
    return true;
  }
  function assertRouteAccess(route, actor, scope) {
    if (!canAccessRoute(route, actor, scope)) throw new Error('route_assignment_denied');
    return true;
  }
  function assertRouteSheetScope(route, sheet) {
    if (!sheet || text(sheet.routeId) !== text(route?.id)) throw new Error('route_sheet_scope_denied');
    return true;
  }
  function event(type, actor = {}, now = Date.now(), details = {}) {
    return { id: safeId('logistics_audit', `${type}:${now}`), type:text(type), at:iso(now), actorId:text(actor.uid || actor.id), actorRole:text(actor.roleId || actor.role), details:{ ...details } };
  }
  function withAudit(record, type, actor, now, details) {
    return { ...record, updatedAt:iso(now), updatedAtMs:now, auditTrail:[...(record.auditTrail || []), event(type, actor, now, details)] };
  }

  function normalizeVehicle(input = {}, now = Date.now()) {
    return {
      id:text(input.id) || safeId('vehicle', `${input.businessId}:${input.plate}:${now}`),
      businessId:text(input.businessId), plate:text(input.plate).toUpperCase(), name:text(input.name), driverId:text(input.driverId), driverName:text(input.driverName), capacity:Math.max(0, number(input.capacity)), capacityUnit:text(input.capacityUnit || 'unidades'), status:['active', 'inactive', 'maintenance'].includes(input.status) ? input.status : 'active', notes:text(input.notes), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), updatedAt:text(input.updatedAt) || iso(now), updatedAtMs:number(input.updatedAtMs, now), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : []
    };
  }
  function normalizeRoute(input = {}, now = Date.now()) {
    return {
      id:text(input.id) || safeId('route', `${input.businessId}:${input.name}:${now}`), businessId:text(input.businessId), name:text(input.name), zone:text(input.zone), date:text(input.date), vehicleId:text(input.vehicleId), sellerId:text(input.sellerId), sellerName:text(input.sellerName), helperId:text(input.helperId), helperName:text(input.helperName), collectorId:text(input.collectorId), collectorName:text(input.collectorName), status:ROUTE_STATUS.includes(input.status) ? input.status : 'draft', customerIds:unique(input.customerIds), notes:text(input.notes), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), updatedAt:text(input.updatedAt) || iso(now), updatedAtMs:number(input.updatedAtMs, now), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : []
    };
  }
  function normalizeLoadItem(input = {}, now = Date.now()) {
    const qty = Math.max(1, quantity(input.qty || 1));
    const price = Math.max(0, money(input.price == null ? input.routePrice : input.price));
    return { id:text(input.id) || safeId('load_item', `${input.productId || input.code}:${now}`), productId:text(input.productId), code:text(input.code), name:text(input.name || 'Producto'), qty, price, total:money(qty * price), lot:text(input.lot), createdAt:text(input.createdAt) || iso(now) };
  }
  function normalizeLoadSheet(input = {}, now = Date.now()) {
    const items = (input.items || []).map((item) => normalizeLoadItem(item, now));
    return {
      id:text(input.id) || safeId('load_sheet', `${input.businessId}:${input.routeId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), status:LOAD_SHEET_STATUS.includes(input.status) ? input.status : 'draft', items, confirmedAt:text(input.confirmedAt), dispatchedAt:text(input.dispatchedAt), stockCommittedAt:text(input.stockCommittedAt), closedAt:text(input.closedAt), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), updatedAt:text(input.updatedAt) || iso(now), updatedAtMs:number(input.updatedAtMs, now), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : []
    };
  }
  function normalizeRouteSale(input = {}, now = Date.now()) {
    const items = (input.items || []).map((item) => normalizeLoadItem(item, now));
    const subtotal = money(items.reduce((sum, item) => sum + item.total, 0));
    const discount = Math.max(0, money(input.discount));
    const total = Math.max(0, money(subtotal - discount));
    const paymentType = PAYMENT_TYPES.includes(input.paymentType) ? input.paymentType : 'cash';
    const paidAmount = money(input.paidAmount == null ? (paymentType === 'credit' ? 0 : total) : input.paidAmount);
    return {
      id:text(input.id) || safeId('route_sale', `${input.businessId}:${input.routeId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), loadSheetId:text(input.loadSheetId), customerId:text(input.customerId), customerName:text(input.customerName || 'Cliente de ruta'), items, subtotal, discount, total, paymentType, paidAmount, balance:Math.max(0, money(total - paidAmount)), status:text(input.status) || (paymentType === 'credit' ? 'credit' : 'paid'), note:text(input.note), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), createdBy:text(input.createdBy), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : []
    };
  }
  function normalizeCollection(input = {}, now = Date.now()) {
    return { id:text(input.id) || safeId('collection', `${input.routeSaleId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), routeSaleId:text(input.routeSaleId), customerId:text(input.customerId), amount:Math.max(0, money(input.amount)), method:text(input.method || 'cash'), note:text(input.note), status:text(input.status || 'confirmed'), idempotencyKey:text(input.idempotencyKey), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), createdBy:text(input.createdBy) };
  }
  function normalizeReturn(input = {}, now = Date.now()) {
    return { id:text(input.id) || safeId('return', `${input.routeId}:${input.productId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), loadSheetId:text(input.loadSheetId), productId:text(input.productId), code:text(input.code), name:text(input.name || 'Producto'), qty:Math.max(1, quantity(input.qty || 1)), price:Math.max(0, money(input.price)), condition:RETURN_CONDITIONS.includes(input.condition) ? input.condition : 'sellable', note:text(input.note), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), createdBy:text(input.createdBy), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : [] };
  }
  function normalizeExpense(input = {}, now = Date.now()) {
    return { id:text(input.id) || safeId('route_expense', `${input.routeId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), amount:Math.max(0, money(input.amount)), category:text(input.category || 'Otro'), note:text(input.note), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), createdBy:text(input.createdBy) };
  }
  function normalizeVariance(input = {}, now = Date.now()) {
    const type = input.type === 'overage' ? 'overage' : 'shortage';
    return { id:text(input.id) || safeId(`route_${type}`, `${input.routeId}:${now}`), businessId:text(input.businessId), routeId:text(input.routeId), type, amount:Math.max(0, money(input.amount || input.value)), note:text(input.note), createdAt:text(input.createdAt) || iso(now), createdAtMs:number(input.createdAtMs, now), createdBy:text(input.createdBy), auditTrail:Array.isArray(input.auditTrail) ? input.auditTrail : [] };
  }

  function createVehicle({ input, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'vehicles.write');
    const vehicle = normalizeVehicle(input, now);
    if (!vehicle.businessId || !vehicle.plate) throw new Error('invalid_vehicle');
    return withAudit(vehicle, 'vehicle_created', actor, now, { plate:vehicle.plate });
  }
  function createRoute({ input, actor, vehicle, now = Date.now() } = {}) {
    assertPermission(actor, 'routes.write');
    const route = normalizeRoute(input, now);
    if (!route.businessId || !route.name || !route.date) throw new Error('invalid_route');
    if (route.vehicleId) { assertBusinessScope(vehicle, route.businessId); if (vehicle.status !== 'active') throw new Error('vehicle_not_active'); }
    return withAudit(route, 'route_created', actor, now, { name:route.name, date:route.date });
  }
  function assignRoute({ route, vehicle, seller, helper, collector, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'routes.assign');
    if (!['draft', 'planned'].includes(route.status)) throw new Error('route_not_assignable');
    if (vehicle) { assertBusinessScope(vehicle, route.businessId); if (vehicle.status !== 'active') throw new Error('vehicle_not_active'); }
    return withAudit({ ...route, vehicleId:text(vehicle?.id || route.vehicleId), sellerId:text(seller?.uid || seller?.id || route.sellerId), sellerName:text(seller?.name || route.sellerName), helperId:text(helper?.uid || helper?.id || route.helperId), helperName:text(helper?.name || route.helperName), collectorId:text(collector?.uid || collector?.id || route.collectorId), collectorName:text(collector?.name || route.collectorName), status:'planned' }, 'route_assigned', actor, now, { vehicleId:text(vehicle?.id || route.vehicleId), sellerId:text(seller?.uid || seller?.id || route.sellerId), collectorId:text(collector?.uid || collector?.id || route.collectorId) });
  }
  function createLoadSheet({ input, route, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'loadSheets.write');
    assertBusinessScope(route, input?.businessId);
    if (!['draft', 'planned'].includes(route.status)) throw new Error('route_not_loadable');
    const sheet = normalizeLoadSheet({ ...input, routeId:route.id, businessId:route.businessId }, now);
    return withAudit(sheet, 'load_sheet_created', actor, now, { routeId:route.id });
  }
  function addLoadItem({ sheet, product, qty, routePrice, lot, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'loadSheets.write');
    assertBusinessScope(product, sheet.businessId);
    if (sheet.status !== 'draft') throw new Error('load_sheet_locked');
    const count = Math.max(1, quantity(qty || 1));
    if (number(product.qty) < count) throw new Error('insufficient_inventory');
    const item = normalizeLoadItem({ productId:product.id, code:product.code, name:product.name, qty:count, price:routePrice == null ? product.price : routePrice, lot }, now);
    const existing = (sheet.items || []).find((candidate) => candidate.productId === item.productId && candidate.lot === item.lot && candidate.price === item.price);
    const items = existing ? sheet.items.map((candidate) => candidate.id === existing.id ? normalizeLoadItem({ ...candidate, qty:candidate.qty + count }, now) : candidate) : [...(sheet.items || []), item];
    return withAudit({ ...sheet, items }, 'load_item_added', actor, now, { productId:product.id, qty:count });
  }
  function confirmLoadSheet({ sheet, products = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'loadSheets.write');
    if (sheet.status !== 'draft') throw new Error('load_sheet_not_draft');
    if (!(sheet.items || []).length) throw new Error('load_sheet_empty');
    (sheet.items || []).forEach((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      assertBusinessScope(product, sheet.businessId);
      if (number(product.qty) < item.qty) throw new Error(`insufficient_inventory:${item.productId}`);
    });
    return withAudit({ ...sheet, status:'confirmed', confirmedAt:iso(now) }, 'load_sheet_confirmed', actor, now, { itemCount:sheet.items.length });
  }
  function dispatchLoadSheet({ sheet, route, products = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'loadSheets.write');
    assertBusinessScope(route, sheet.businessId);
    assertRouteSheetScope(route, sheet);
    if (sheet.stockCommittedAt) return { sheet, products, noop:true };
    if (sheet.status !== 'confirmed') throw new Error('load_sheet_not_confirmed');
    const nextProducts = products.map((product) => {
      const item = (sheet.items || []).find((candidate) => candidate.productId === product.id);
      if (!item) return product;
      assertBusinessScope(product, sheet.businessId);
      if (number(product.qty) < item.qty) throw new Error(`insufficient_inventory:${item.productId}`);
      return { ...product, qty:number(product.qty) - item.qty, updatedAt:iso(now), updatedAtMs:now };
    });
    const nextSheet = withAudit({ ...sheet, status:'dispatched', dispatchedAt:iso(now), stockCommittedAt:iso(now) }, 'load_sheet_dispatched', actor, now, { routeId:route.id });
    return { sheet:nextSheet, products:nextProducts, route:withAudit({ ...route, status:'dispatched' }, 'route_dispatched', actor, now, { loadSheetId:sheet.id }), noop:false };
  }
  function loadedQuantity(sheet, productId) { return (sheet?.items || []).filter((item) => item.productId === productId).reduce((sum, item) => sum + item.qty, 0); }
  function soldQuantity(routeSales = [], routeId, productId) { return routeSales.filter((sale) => sale.routeId === routeId && sale.status !== 'cancelled').flatMap((sale) => sale.items || []).filter((item) => item.productId === productId).reduce((sum, item) => sum + item.qty, 0); }
  function returnedQuantity(returns = [], routeId, productId) { return returns.filter((entry) => entry.routeId === routeId && entry.productId === productId).reduce((sum, entry) => sum + entry.qty, 0); }
  function createRouteSale({ input, route, sheet, products = [], routeSales = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'routeSales.create');
    assertBusinessScope(route, input?.businessId);
    assertBusinessScope(sheet, route.businessId);
    assertRouteSheetScope(route, sheet);
    assertRouteAccess(route, actor, 'seller');
    if (!['dispatched', 'in_progress', 'settlement_pending'].includes(route.status) || sheet.status !== 'dispatched') throw new Error('route_not_dispatched');
    const rawItems = input?.items || [];
    if (!rawItems.length) throw new Error('route_sale_empty');
    const items = rawItems.map((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      assertBusinessScope(product, route.businessId);
      const qty = Math.max(1, quantity(line.qty || 1));
      const available = loadedQuantity(sheet, product.id) - soldQuantity(routeSales, route.id, product.id);
      if (qty > available) throw new Error(`route_inventory_exceeded:${product.id}`);
      return normalizeLoadItem({ productId:product.id, code:product.code, name:product.name, qty, price:line.price == null ? product.price : line.price, lot:line.lot }, now);
    });
    const sale = normalizeRouteSale({ ...input, businessId:route.businessId, routeId:route.id, loadSheetId:sheet.id, items, createdBy:text(actor.uid || actor.id) }, now);
    if (sale.discount > 0) assertPermission(actor, 'routeSales.discount');
    if (sale.paidAmount > sale.total + 0.00001) throw new Error('route_sale_overpayment');
    return withAudit(sale, 'route_sale_created', actor, now, { routeId:route.id, paymentType:sale.paymentType, total:sale.total });
  }
  function collectionTotal(routeSaleId, collections = []) { return money(collections.filter((entry) => entry.routeSaleId === routeSaleId && entry.status !== 'cancelled').reduce((sum, entry) => sum + number(entry.amount), 0)); }
  function remainingCredit(sale, collections = []) { return Math.max(0, money(number(sale?.balance) - collectionTotal(sale?.id, collections))); }
  function recordCollection({ input, route, sale, collections = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'collections.write');
    assertBusinessScope(sale, input?.businessId);
    assertBusinessScope(route, sale.businessId);
    if (text(route.id) !== text(sale.routeId)) throw new Error('route_sale_scope_denied');
    assertRouteAccess(route, actor, 'collector');
    if (sale.status === 'cancelled' || sale.balance <= 0) throw new Error('collection_not_available');
    const candidate = normalizeCollection({ ...input, businessId:sale.businessId, routeId:sale.routeId, routeSaleId:sale.id, customerId:sale.customerId, createdBy:text(actor.uid || actor.id) }, now);
    if (!candidate.idempotencyKey) throw new Error('collection_idempotency_required');
    const existing = collections.find((entry) => entry.idempotencyKey === candidate.idempotencyKey && entry.routeSaleId === sale.id);
    if (existing) return { collection:existing, noop:true };
    if (candidate.amount <= 0 || candidate.amount > remainingCredit(sale, collections) + 0.00001) throw new Error('collection_amount_invalid');
    return { collection:candidate, noop:false };
  }
  function recordReturn({ input, route, sheet, routeSales = [], returns = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'returns.write');
    assertBusinessScope(route, input?.businessId);
    assertBusinessScope(sheet, route.businessId);
    assertRouteSheetScope(route, sheet);
    assertRouteAccess(route, actor, 'seller');
    if (!['dispatched', 'in_progress', 'settlement_pending'].includes(route.status)) throw new Error('route_not_returnable');
    const entry = normalizeReturn({ ...input, businessId:route.businessId, routeId:route.id, loadSheetId:sheet.id, createdBy:text(actor.uid || actor.id) }, now);
    const loaded = loadedQuantity(sheet, entry.productId);
    const sold = soldQuantity(routeSales, route.id, entry.productId);
    const alreadyReturned = returnedQuantity(returns, route.id, entry.productId);
    if (!loaded || entry.qty > Math.max(0, loaded - sold - alreadyReturned)) throw new Error('return_quantity_invalid');
    return { ...entry, auditTrail:[event('route_return_recorded', actor, now, { productId:entry.productId, qty:entry.qty, condition:entry.condition })] };
  }
  function recordExpense({ input, route, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.write');
    assertBusinessScope(route, input?.businessId);
    if (!['dispatched', 'in_progress', 'settlement_pending'].includes(route.status)) throw new Error('route_not_expensable');
    const expense = normalizeExpense({ ...input, businessId:route.businessId, routeId:route.id, createdBy:text(actor.uid || actor.id) }, now);
    if (expense.amount <= 0) throw new Error('expense_amount_invalid');
    return expense;
  }
  function recordVariance({ input, route, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'returns.write');
    assertBusinessScope(route, input?.businessId);
    assertRouteAccess(route, actor, 'seller');
    if (!['dispatched', 'in_progress', 'settlement_pending'].includes(route.status)) throw new Error('route_not_variance_trackable');
    const variance = normalizeVariance({ ...input, businessId:route.businessId, routeId:route.id, createdBy:text(actor.uid || actor.id) }, now);
    if (variance.amount <= 0) throw new Error('variance_amount_invalid');
    return { ...variance, auditTrail:[event(`route_${variance.type}_recorded`, actor, now, { amount:variance.amount })] };
  }
  function settlementCalculation({ route, sheet, routeSales = [], collections = [], returns = [], expenses = [], shortages = [], overages = [] } = {}) {
    const scopedSales = routeSales.filter((sale) => sale.routeId === route.id && sale.status !== 'cancelled');
    const scopedCollections = collections.filter((entry) => entry.routeId === route.id && entry.status !== 'cancelled');
    const scopedReturns = returns.filter((entry) => entry.routeId === route.id);
    const scopedExpenses = expenses.filter((entry) => entry.routeId === route.id);
    const scopedShortages = shortages.filter((entry) => entry.routeId === route.id);
    const scopedOverages = overages.filter((entry) => entry.routeId === route.id);
    const salesTotal = money(scopedSales.reduce((sum, sale) => sum + number(sale.total), 0));
    const cashSales = money(scopedSales.filter((sale) => sale.paymentType !== 'credit').reduce((sum, sale) => sum + number(sale.paidAmount), 0));
    const creditSales = money(scopedSales.filter((sale) => sale.paymentType === 'credit').reduce((sum, sale) => sum + number(sale.total), 0));
    const collectionsTotal = money(scopedCollections.reduce((sum, entry) => sum + number(entry.amount), 0));
    const expensesTotal = money(scopedExpenses.reduce((sum, entry) => sum + number(entry.amount), 0));
    const sellableReturns = scopedReturns.filter((entry) => entry.condition === 'sellable');
    const damagedReturns = scopedReturns.filter((entry) => entry.condition === 'damaged');
    const sellableReturnValue = money(sellableReturns.reduce((sum, entry) => sum + entry.qty * number(entry.price), 0));
    const damagedReturnValue = money(damagedReturns.reduce((sum, entry) => sum + entry.qty * number(entry.price), 0));
    const shortageValue = money(scopedShortages.reduce((sum, entry) => sum + number(entry.amount || entry.value), 0));
    const overageValue = money(scopedOverages.reduce((sum, entry) => sum + number(entry.amount || entry.value), 0));
    return { routeId:route.id, loadSheetId:sheet?.id || '', loadValue:money((sheet?.items || []).reduce((sum, item) => sum + number(item.total), 0)), salesTotal, cashSales, creditSales, collectionsTotal, expensesTotal, sellableReturnValue, damagedReturnValue, shortageValue, overageValue, expectedCash:money(cashSales + collectionsTotal - expensesTotal), openCredit:money(scopedSales.reduce((sum, sale) => sum + remainingCredit(sale, collections), 0)), saleCount:scopedSales.length, returnCount:scopedReturns.length };
  }
  function createSettlement({ input, route, sheet, routeSales, collections, returns, expenses, shortages, overages, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.write');
    assertBusinessScope(route, input?.businessId);
    assertBusinessScope(sheet, route.businessId);
    assertRouteSheetScope(route, sheet);
    if (!['dispatched', 'in_progress', 'settlement_pending'].includes(route.status)) throw new Error('route_not_settleable');
    const calculation = settlementCalculation({ route, sheet, routeSales, collections, returns, expenses, shortages, overages });
    const receivedCash = Math.max(0, money(input.receivedCash));
    const settlement = { id:text(input.id) || safeId('route_settlement', `${route.id}:${now}`), businessId:route.businessId, routeId:route.id, loadSheetId:sheet.id, status:'pending_approval', receivedCash, difference:money(receivedCash - calculation.expectedCash), calculation, createdAt:iso(now), createdAtMs:now, updatedAt:iso(now), updatedAtMs:now, auditTrail:[event('route_settlement_created', actor, now, { expectedCash:calculation.expectedCash, receivedCash })] };
    return { settlement, route:withAudit({ ...route, status:'settlement_pending' }, 'route_settlement_pending', actor, now, { settlementId:settlement.id }) };
  }
  function approveSettlement({ settlement, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.approve');
    if (!['pending_approval', 'reopened'].includes(settlement.status)) throw new Error('settlement_not_approvable');
    return withAudit({ ...settlement, status:'approved', approvedAt:iso(now), approvedBy:text(actor.uid || actor.id) }, 'route_settlement_approved', actor, now, { difference:settlement.difference });
  }
  function closeSettlement({ settlement, route, products = [], returns = [], actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.approve');
    assertBusinessScope(route, settlement.businessId);
    if (settlement.status === 'closed') throw new Error('settlement_already_closed');
    if (settlement.status !== 'approved') throw new Error('settlement_not_approved');
    const sellable = returns.filter((entry) => entry.routeId === route.id && entry.condition === 'sellable');
    const nextProducts = products.map((product) => {
      if (settlement.stockRestoredAt) return product;
      const restore = sellable.filter((entry) => entry.productId === product.id).reduce((sum, entry) => sum + entry.qty, 0);
      if (!restore) return product;
      assertBusinessScope(product, settlement.businessId);
      return { ...product, qty:number(product.qty) + restore, updatedAt:iso(now), updatedAtMs:now };
    });
    return { settlement:withAudit({ ...settlement, status:'closed', closedAt:iso(now), stockRestoredAt:settlement.stockRestoredAt || iso(now) }, 'route_settlement_closed', actor, now, { sellableReturnCount:settlement.stockRestoredAt ? 0 : sellable.length }), route:withAudit({ ...route, status:'closed' }, 'route_closed', actor, now, { settlementId:settlement.id }), products:nextProducts };
  }
  // r36: explicit reject/observe path -- a settlement still pending_approval
  // can be sent back with a required reason instead of only ever being
  // approved. The route returns to 'in_progress' so the route seller can
  // correct whatever was flagged and call createSettlement() again; the
  // rejected settlement itself is never deleted, only superseded, so the
  // observation stays in the audit trail permanently.
  function rejectSettlement({ settlement, route, reason, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.approve');
    assertBusinessScope(route, settlement.businessId);
    if (settlement.status !== 'pending_approval') throw new Error('settlement_not_rejectable');
    if (!text(reason)) throw new Error('reject_reason_required');
    return {
      settlement: withAudit({ ...settlement, status:'rejected', rejectedAt:iso(now), rejectReason:text(reason) }, 'route_settlement_rejected', actor, now, { reason:text(reason) }),
      route: withAudit({ ...route, status:'in_progress' }, 'route_settlement_rejected', actor, now, { settlementId:settlement.id })
    };
  }
  function reopenSettlement({ settlement, route, reason, actor, now = Date.now() } = {}) {
    assertPermission(actor, 'settlements.reopen');
    assertBusinessScope(route, settlement.businessId);
    if (!['approved', 'closed'].includes(settlement.status)) throw new Error('settlement_not_reopenable');
    if (!text(reason)) throw new Error('reopen_reason_required');
    return { settlement:withAudit({ ...settlement, status:'reopened', reopenedAt:iso(now), reopenReason:text(reason) }, 'route_settlement_reopened', actor, now, { reason:text(reason) }), route:withAudit({ ...route, status:'settlement_pending' }, 'route_reopened', actor, now, { settlementId:settlement.id }) };
  }
  function printDocument({ kind = 'load_sheet', businessName, route, sheet, settlement } = {}) {
    const title = kind === 'settlement' ? 'LIQUIDACIÓN DE RUTA' : 'HOJA DE CARGA';
    const rows = kind === 'settlement'
      ? `<li>Esperado: ${money(settlement?.calculation?.expectedCash).toFixed(2)}</li><li>Recibido: ${money(settlement?.receivedCash).toFixed(2)}</li><li>Diferencia: ${money(settlement?.difference).toFixed(2)}</li>`
      : (sheet?.items || []).map((item) => `<li><b>${item.qty} x ${escapeHtml(item.name)}</b><small>${escapeHtml(item.code)}</small></li>`).join('');
    return `<article class="logisticsPrint"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(businessName)} · ${escapeHtml(route?.name || '')}</p><p>${escapeHtml(route?.date || '')}</p><ul>${rows || '<li>Sin registros.</li>'}</ul></article>`;
  }
  function logisticsReport({ businessId, routes = [], routeSales = [], collections = [], returns = [], settlements = [] } = {}) {
    const scopedRoutes = routes.filter((route) => route.businessId === businessId);
    const sales = routeSales.filter((sale) => sale.businessId === businessId && sale.status !== 'cancelled');
    const scopedCollections = collections.filter((entry) => entry.businessId === businessId && entry.status !== 'cancelled');
    const scopedReturns = returns.filter((entry) => entry.businessId === businessId);
    const scopedSettlements = settlements.filter((entry) => entry.businessId === businessId);
    const byRoute = {};
    const bySeller = {};
    sales.forEach((sale) => { byRoute[sale.routeId] = money((byRoute[sale.routeId] || 0) + sale.total); const route = scopedRoutes.find((entry) => entry.id === sale.routeId); const seller = route?.sellerName || 'Sin vendedor'; bySeller[seller] = money((bySeller[seller] || 0) + sale.total); });
    return { routeCount:scopedRoutes.length, openRoutes:scopedRoutes.filter((route) => !['closed', 'cancelled'].includes(route.status)).length, sales:money(sales.reduce((sum, sale) => sum + sale.total, 0)), credits:money(sales.reduce((sum, sale) => sum + remainingCredit(sale, scopedCollections), 0)), collections:money(scopedCollections.reduce((sum, entry) => sum + entry.amount, 0)), sellableReturns:scopedReturns.filter((entry) => entry.condition === 'sellable').reduce((sum, entry) => sum + entry.qty, 0), damagedReturns:scopedReturns.filter((entry) => entry.condition === 'damaged').reduce((sum, entry) => sum + entry.qty, 0), settlementsPending:scopedSettlements.filter((entry) => ['pending_approval', 'reopened'].includes(entry.status)).length, byRoute, bySeller };
  }

  root.CLICK360_P2_LOGISTICS = Object.freeze({
    ROUTE_STATUS, LOAD_SHEET_STATUS, SETTLEMENT_STATUS, PAYMENT_TYPES, RETURN_CONDITIONS, PERMISSIONS,
    rolePermissions, hasPermission, assertBusinessScope, actorRole, canAccessRoute, assertRouteAccess, assertRouteSheetScope, normalizeVehicle, normalizeRoute, normalizeLoadItem,
    normalizeLoadSheet, normalizeRouteSale, normalizeCollection, normalizeReturn, normalizeExpense, normalizeVariance,
    createVehicle, createRoute, assignRoute, createLoadSheet, addLoadItem, confirmLoadSheet, dispatchLoadSheet,
    loadedQuantity, soldQuantity, returnedQuantity, createRouteSale, collectionTotal, remainingCredit, recordCollection,
    recordReturn, recordExpense, recordVariance, settlementCalculation, createSettlement, approveSettlement, rejectSettlement, closeSettlement, reopenSettlement,
    printDocument, logisticsReport
  });
})(typeof window !== 'undefined' ? window : globalThis);
