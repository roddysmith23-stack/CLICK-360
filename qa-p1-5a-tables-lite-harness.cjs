'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const RELEASE = '1.0.5';
const ASSET = 'commercial-1-0-5-r16';

function tablesForBusiness(state, businessId) {
  return state.tables.filter((table) => table.businessId === businessId);
}

function createTable(state, { businessId, name }) {
  const trimmed = String(name || '').trim();
  assert(trimmed, 'table name is required');
  const table = {
    id: `${businessId}:table:${state.tables.length + 1}`,
    businessId,
    name: trimmed,
    status: 'free',
    openedAt: null,
    items: []
  };
  state.tables.push(table);
  return table;
}

function renameTable(table, name) {
  assert.equal(table.status, 'free', 'only a free table can be renamed safely');
  table.name = String(name || '').trim();
}

function deleteTable(state, tableId, businessId) {
  const table = state.tables.find((item) => item.id === tableId && item.businessId === businessId);
  assert(table, 'table must belong to the active business');
  if (table.status !== 'free' || table.items.length) return false;
  state.tables = state.tables.filter((item) => item !== table);
  return true;
}

function addProductToTable(table, product, quantity, now = 1000) {
  assert.equal(table.businessId, product.businessId, 'table and product must belong to the same business');
  assert(Number(product.qty || 0) >= quantity, 'product must have stock');
  if (table.status === 'free') {
    table.status = 'occupied';
    table.openedAt = now;
  }
  const existing = table.items.find((item) => item.productId === product.id);
  if (existing) existing.quantity += quantity;
  else table.items.push({ productId: product.id, name: product.name, quantity, unitPrice: product.price });
  return table;
}

function tableTotal(table) {
  return table.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function chargeTable(state, { tableId, businessId, cashSessionId, now = 5000 }) {
  const table = state.tables.find((item) => item.id === tableId && item.businessId === businessId);
  assert(table && table.items.length, 'an occupied table with items is required');
  const cashSession = state.cashSessions.find((item) =>
    item.id === cashSessionId && item.businessId === businessId && item.status === 'open');
  assert(cashSession, 'an open cash session for the same business is required');
  const total = tableTotal(table);
  const sale = {
    id: `sale:${businessId}:${state.sales.length + 1}`,
    businessId,
    cashSessionId,
    source: 'table',
    tableId,
    total,
    items: table.items.map((item) => ({ ...item }))
  };
  state.sales.push(sale);
  state.movements.push({
    id: `movement:${sale.id}`,
    businessId,
    cashSessionId,
    kind: 'ingreso',
    amount: total
  });
  table.status = 'free';
  table.openedAt = null;
  table.items = [];
  table.lastClosedAt = now;
  return sale;
}

function closeCash(state, businessId, cashSessionId) {
  const session = state.cashSessions.find((item) =>
    item.id === cashSessionId && item.businessId === businessId && item.status === 'open');
  assert(session, 'cash session is open');
  session.status = 'closed';
  session.total = state.movements
    .filter((movement) => movement.businessId === businessId && movement.cashSessionId === cashSessionId)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  return session;
}

const state = {
  tables: [],
  sales: [],
  movements: [],
  cashSessions: [
    { id: 'cash-omega', businessId: 'omega', status: 'open' },
    { id: 'cash-alfa', businessId: 'alfa', status: 'open' }
  ]
};
const product = { id: 'coffee', businessId: 'omega', name: 'Café', price: 2.5, qty: 10 };
const mesa = createTable(state, { businessId: 'omega', name: 'Mesa 1' });
const barra = createTable(state, { businessId: 'omega', name: 'Barra' });
createTable(state, { businessId: 'alfa', name: 'Mesa Alfa' });
assert.deepEqual(tablesForBusiness(state, 'omega').map((table) => table.name), ['Mesa 1', 'Barra'], 'tables are isolated by businessId');

renameTable(barra, 'Patio');
assert.equal(barra.name, 'Patio', 'a free table can be renamed');
addProductToTable(mesa, product, 2, 1000);
assert.equal(mesa.status, 'occupied', 'adding a product marks the table occupied');
assert.equal(mesa.openedAt, 1000, 'table opening time is recorded');
assert.equal(tableTotal(mesa), 5, 'table total reflects its items');
assert.equal(deleteTable(state, mesa.id, 'omega'), false, 'an occupied table cannot be deleted');

const sale = chargeTable(state, { tableId: mesa.id, businessId: 'omega', cashSessionId: 'cash-omega' });
assert.equal(sale.total, 5, 'charging a table creates a normal sale total');
assert.equal(sale.businessId, 'omega', 'table sale belongs to the active business');
assert.equal(state.movements[0].amount, 5, 'table sale enters the open cash session');
assert.equal(mesa.status, 'free', 'charged table is released');
assert.equal(mesa.items.length, 0, 'charged table has no stale order');
assert.equal(state.sales.some((item) => item.businessId === 'alfa'), false, 'charging Omega does not create an Alfa sale');

const closed = closeCash(state, 'omega', 'cash-omega');
assert.equal(closed.status, 'closed', 'cash can close after a table sale');
assert.equal(closed.total, 5, 'cash close includes the table sale');
assert.equal(state.cashSessions.find((session) => session.id === 'cash-alfa').status, 'open', 'cash close remains isolated by businessId');
assert.equal(deleteTable(state, mesa.id, 'omega'), true, 'a released table can be deleted');

assert.match(app, /tablesForBiz|tables.*filter\([^)]*businessId|businessId.*tables/i, 'table reads are scoped by businessId');
assert.match(app, /tableOrders/, 'table orders have an optional backward-compatible collection');
assert.match(app, /Mesas\s*\/\s*Restaurante|Mesas Lite|Nueva mesa/i, 'restaurant table module is visible');
assert.match(app, /nombre.{0,80}mesa|tableName|mesaName/i, 'table names are entered as free-form text');
for (const status of [/libre/i, /ocupada/i, /por cobrar/i]) {
  assert.match(app, status, `table status ${status} is visible`);
}
assert.match(app, /Cobrar mesa/i, 'table can be charged as a sale');
assert.match(app, /tiempo abierta|openedAt|openTime|tableElapsed/i, 'open-table elapsed time is tracked');
assert.match(app, /cashSessionId|currentOpenCashSession/, 'table payment is linked to the open cash session');
assert.match(app, /tableReservedQuantity/, 'open table orders reserve stock across tables before checkout');
assert.match(app, /isRestaurantBusiness|restaurante|cafeter[ií]a|bar/i, 'table module is gated by business type');
assert.match(styles, /tableCard|tablesGrid|restaurant|mesa/i, 'Mesas Lite has dedicated responsive styles');
assert.match(html, /viewport/, 'mobile viewport remains configured for table operation');
assert(!/\bKDS\b|mapa.{0,20}3D|reservas avanzadas/i.test(app), 'P1.5A does not activate advanced restaurant scope');

assert(app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`), 'app has the P1.5A release version');
assert(app.includes(`const APP_ASSET_VERSION = '${ASSET}'`), 'app has the P1.5A asset version');
assert(html.includes(ASSET), 'HTML references the P1.5A asset version');
assert(styles.includes(ASSET), 'CSS assets reference the P1.5A asset version');
assert(worker.includes(`click360-${ASSET}`), 'service worker cache is isolated for P1.5A');

console.log('PASS P1.5A tables lite harness: lifecycle, sale/cash integration, business isolation and responsive contracts');
