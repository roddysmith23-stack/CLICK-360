'use strict';

const assert = require('node:assert/strict');
const { money, pick } = require('./seed-data.cjs');
const { hash } = require('./fake-storage.cjs');
const { assertCoreInvariants } = require('./invariants.cjs');

function today() {
  return '2026-07-18';
}

function activeBusiness(state) {
  return state.businesses.find((business) => business.id === state.activeBusinessId) || state.businesses[0];
}

function switchBusiness(state, businessId) {
  assert(state.businesses.some((business) => business.id === businessId), `unknown business ${businessId}`);
  state.activeBusinessId = businessId;
  state.updatedAtMs += 1;
  return { type: 'business_switch', businessId };
}

function ensureOpenCash(state, businessId = activeBusiness(state).id) {
  const existing = state.cashSessions.find((session) => session.businessId === businessId && session.date === today() && session.status === 'open');
  if (existing) return existing;
  const session = {
    id: `cash-${businessId}-${state.cashSessions.length + 1}`,
    businessId,
    date: today(),
    status: 'open',
    openingAmount: state.businesses.find((business) => business.id === businessId)?.lastCashBalance || 0,
    reportId: ''
  };
  state.cashSessions.push(session);
  state.movements.push({
    id: `mov-open-${session.id}`,
    businessId,
    date: today(),
    kind: 'apertura',
    amount: session.openingAmount,
    cashSessionId: session.id
  });
  return session;
}

function createSale(state, random, businessId = activeBusiness(state).id) {
  const session = ensureOpenCash(state, businessId);
  const products = state.products.filter((product) => product.businessId === businessId && product.stock > 0);
  if (!products.length) return { type: 'sale_skipped', businessId };
  const product = pick(random, products);
  const qty = 1 + Math.floor(random() * Math.min(3, product.stock));
  product.stock -= qty;
  const method = pick(random, ['Efectivo', 'Tarjeta', 'Transferencia']);
  const sale = {
    id: `sale-${state.sales.length + 1}`,
    businessId,
    date: today(),
    status: 'paid',
    method,
    total: money(product.price * qty),
    iva: money(product.price * qty * 0.12),
    cashSessionId: session.id,
    items: [{ id: product.id, qty, name: product.name }]
  };
  state.sales.push(sale);
  state.movements.push({
    id: `mov-sale-${sale.id}`,
    businessId,
    date: today(),
    kind: 'ingreso',
    amount: sale.total,
    paymentMethod: method,
    cashSessionId: session.id
  });
  return { type: 'sale', businessId, method, total: sale.total };
}

function createCashMovement(state, random, businessId = activeBusiness(state).id) {
  const session = ensureOpenCash(state, businessId);
  const kind = pick(random, ['egreso', 'compra', 'retiro', 'ingreso']);
  const movement = {
    id: `mov-${state.movements.length + 1}`,
    businessId,
    date: today(),
    kind,
    amount: money(1 + random() * 80),
    paymentMethod: kind === 'ingreso' ? 'Efectivo' : null,
    cashSessionId: session.id
  };
  state.movements.push(movement);
  return { type: 'movement', businessId, kind, amount: movement.amount };
}

function closeCash(state, { businessId = activeBusiness(state).id, countedCash = null, role = 'owner', readOnly = false, gateAllowed = true } = {}) {
  if (readOnly) return { ok: false, type: 'cash_close', stage: 'cash_close_validate_access', reason: 'read_only' };
  if (!gateAllowed) return { ok: false, type: 'cash_close', stage: 'cash_close_validate_access', reason: 'pending_remote_sync' };
  if (role !== 'owner') return { ok: false, type: 'cash_close', stage: 'cash_close_validate_access', reason: 'worker_module_paused' };
  const session = ensureOpenCash(state, businessId);
  const existing = state.dailyReports.find((report) => report.businessId === businessId && report.date === today() && report.cashSessionId === session.id && report.status === 'closed');
  if (existing) return { ok: true, type: 'cash_close', noop: true, businessId };
  const movements = state.movements.filter((movement) => movement.businessId === businessId && movement.date === today() && movement.cashSessionId === session.id);
  const opening = movements.slice().reverse().find((movement) => movement.kind === 'apertura')?.amount || 0;
  const income = movements.filter((movement) => movement.kind === 'ingreso').reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const out = movements.filter((movement) => !['ingreso', 'apertura'].includes(movement.kind)).reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const expectedCash = money(opening + income - out);
  const closeCashAmount = countedCash == null ? expectedCash : money(countedCash);
  const report = {
    id: `report-${state.dailyReports.length + 1}`,
    businessId,
    date: today(),
    cashSessionId: session.id,
    status: 'closed',
    expectedCash,
    countedCash: closeCashAmount,
    closeCash: closeCashAmount,
    difference: money(closeCashAmount - expectedCash),
    html: '<div>CIERRE DE CAJA QA</div>'
  };
  state.dailyReports.push(report);
  Object.assign(session, { status: 'closed', reportId: report.id, expectedCash, countedCash: closeCashAmount });
  const business = state.businesses.find((item) => item.id === businessId);
  business.lastCashBalance = closeCashAmount;
  state.auditLogs.push({ id: `audit-${state.auditLogs.length + 1}`, action: 'cash_closed', businessId, reportId: report.id });
  return { ok: true, type: 'cash_close', businessId, reportId: report.id, expectedCash };
}

function syncToCloud({ state, cloud, localStore, reason = 'qa_sync' }) {
  const before = cloud.read();
  localStore.setItem('CLICK360_QA_STATE', JSON.stringify(state));
  const result = cloud.write(state, { expectedRevision: before.revision, reason });
  assert.equal(result.ok, true, `cloud sync ${reason} succeeds`);
  return result;
}

function runScenario({ state, random, cloud, localStore, iterations, businessSwitches, closes, sales, movements, mode }) {
  const actions = [];
  let salesDone = 0;
  let movementsDone = 0;
  let closesDone = 0;
  let switchesDone = 0;
  for (let index = 0; index < iterations; index += 1) {
    const business = pick(random, state.businesses);
    if (switchesDone < businessSwitches) {
      actions.push(switchBusiness(state, business.id));
      switchesDone += 1;
    }
    if (salesDone < sales) {
      actions.push(createSale(state, random, business.id));
      salesDone += 1;
    }
    if (movementsDone < movements) {
      actions.push(createCashMovement(state, random, business.id));
      movementsDone += 1;
    }
    if (closesDone < closes && index % Math.max(1, Math.floor(iterations / closes)) === 0) {
      actions.push(closeCash(state, { businessId: business.id }));
      closesDone += 1;
    }
    if (index % 25 === 0) syncToCloud({ state, cloud, localStore, reason: `${mode}_batch_${index}` });
    assertCoreInvariants(state);
  }
  syncToCloud({ state, cloud, localStore, reason: `${mode}_final` });
  const final = assertCoreInvariants(state);
  return { actions: actions.length, salesDone, movementsDone, closesDone, switchesDone, finalHash: hash(state), invariant: final };
}

module.exports = { closeCash, createCashMovement, createSale, ensureOpenCash, runScenario, switchBusiness };
