'use strict';

// Synthetic, network-free execution of the actual production checkout and
// close-summary functions. No copied financial algorithm and no real tenant.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.CLICK360_COMMERCE_APP_SOURCE || 'app.js', 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `production source boundaries: ${start}`);
  return source.slice(from, to);
}
const checkout = between("$('#chargeBtn').onclick=async()=>{", '\n  function decodeLocalC360QR');
// The extracted source includes bindSell's closing brace; execute inside the
// same enclosing function shape, with its dependencies provided as fixtures.
const cashIncome = between('function isCashIncomeMovement(m)', '  function isDayStarted()');
const cashSummary = between('function buildCashCloseSummary(', '  function showCashCloseSummary(');
const results = [];
async function checkoutCase(method, latencyMs, namedDomProperty, commitMode = 'success') {
  const fields = Object.fromEntries(Object.entries({
    chargeBtn: '', discount: '0', payMethod: method, cashReceived: method === 'Apartado' ? '5' : '20',
    customer: 'Synthetic customer', customerCedula: 'TEST-IDENTITY', customerPhone: '000000000',
    layawayDueDate: '2099-01-01', layawayInitialMethod: 'Transferencia', layawayTermsAccepted: ''
  }).map(([id, value]) => [id, { value, disabled: false, checked: true }]));
  const state = {
    products: [{ id: 'product-1', businessId: 'synthetic-business', stock: 10, qty: 10 }],
    sales: [], movements: [], operationLedger: [], layaways: []
  };
  let counter = 0;
  let commits = 0;
  let receipts = 0;
  const fixture = {
    state, cart: [{ id: 'product-1', name: 'Synthetic product', code: 'SYNTH-1', price: 20, cardPrice: 20, qty: 1 }],
    $: (selector) => fields[selector.slice(1)],
    parseMoney: Number, fmt: (value) => `$${Number(value).toFixed(2)}`,
    calculateCurrentCart: () => ({ subtotal: 20, tax: 0, total: 20, displaySubtotal: 20, lines: [{ id: 'product-1', name: 'Synthetic product', code: 'SYNTH-1', qty: 1, unitPrice: 20, base: 20, tax: 0, total: 20 }] }),
    currentBusiness: () => ({ id: 'synthetic-business' }), currentTax: { rate: 0, priceMode: 'excluded' },
    currentOpenCashSession: () => ({ id: 'cash-synthetic' }), authUser: () => ({ name: 'Synthetic owner' }),
    cloneState: (value) => JSON.parse(JSON.stringify(value)), uid: (prefix) => `${prefix}-${++counter}`,
    today: () => '2026-08-30', nowLabel: () => '2026-08-30 12:00',
    businessPolicies: () => ({ version: 1 }), layawayTermsText: () => 'Synthetic fixture',
    addAudit: () => {}, beep: () => {}, toast: () => {}, renderCart: () => {}, renderApp: () => {},
    actionId: (id) => id, window: { printReceipt: () => { receipts += 1; } },
    setTimeout: (callback) => callback(),
    commitCriticalMutation: async (previousState) => {
      commits += 1;
      if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (commitMode !== 'success') {
        Object.assign(state, previousState);
        if (commitMode === 'throw') throw new Error('Synthetic transport failure');
        return { ok: false, pending: false };
      }
      return { ok: true, pending: false };
    }
  };
  // bindSell owns this helper in production; the extracted checkout slice
  // receives the equivalent shared-cart replacement seam explicitly.
  fixture.replaceCart = (next) => { fixture.cart = next; };
  // Browsers expose element IDs as named window properties. The unbound
  // variable can therefore silently become the SELECT object, not a string.
  if (namedDomProperty) fixture.layawayInitialMethod = fields.layawayInitialMethod;
  vm.runInNewContext(`'use strict'; (function bindSell(){\n${checkout}\n)();`, fixture);
  const startedAt = performance.now();
  const attempts = Array.from({ length: 5 }, () => fields.chargeBtn.onclick());
  const dispatchMs = performance.now() - startedAt;
  const outcomes = await Promise.allSettled(attempts);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  if (commitMode !== 'success') {
    assert.equal(state.sales.length, 0); assert.equal(state.movements.length, 0);
    assert.equal(state.products[0].stock, 10); assert.equal(receipts, 0);
    assert.equal(commits, 1); assert.equal(fields.chargeBtn.disabled, false, 'failure re-enables checkout');
    assert.equal(Boolean(rejected), commitMode === 'throw');
    return { method, commitMode, latencyMs, commits, receipts, stock: 10 };
  }
  if (rejected) throw rejected.reason;
  const expectedMethod = method === 'Apartado' ? 'Transferencia' : method;
  assert(dispatchMs < 300, `five clicks dispatch in <300ms, got ${dispatchMs}`);
  assert.equal(state.sales.length, 1, 'exactly one sale');
  assert.equal(state.movements.length, 1, 'exactly one movement');
  assert.equal(state.products[0].stock, 9, 'stock decremented once');
  assert.equal(state.products[0].qty, 9, 'legacy quantity stays canonical');
  assert.equal(commits, 1, 'exactly one critical commit');
  assert.equal(receipts, 1, 'exactly one receipt request');
  assert.equal(fields.chargeBtn.disabled, false, 'button re-enabled');
  assert.equal(state.sales[0].payments[0].method, expectedMethod, 'payment method must be a primitive method string');
  assert.equal(state.movements[0].paymentMethod, expectedMethod, 'movement method must match actual tender');
  return { method, latencyMs, namedDomProperty, dispatchMs, saleCount: 1, movementCount: 1, stock: 9, receipts: 1 };
}

function closingCase() {
  const methods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Apartado'];
  const totals = [20, 25, 30, 40];
  const amounts = [20, 25, 30, 5];
  const movements = methods.map((method, index) => ({
    kind: 'ingreso', amount: amounts[index], paymentMethod: method === 'Apartado' ? 'Transferencia' : method,
    paymentType: method === 'Apartado' ? 'receivable_payment' : 'sale'
  }));
  const fixture = {
    state: { sales: methods.map((method, index) => ({ id: `sale-${index}`, businessId: 'synthetic-business', date: '2026-08-30', status: 'paid', method, total: totals[index], items: [{ qty: 1 }] })) },
    updateCashCloseDiagnostic: () => {}, saleItems: (sale) => sale.items,
    escapeHtml: String, safeImageSrc: () => '', nowLabel: () => '2026-08-30',
    authUser: () => ({ name: 'Synthetic owner' }), fmt: (value) => `$${Number(value).toFixed(2)}`,
    basis: { business: { name: 'Synthetic business', settings: {} }, businessId: 'synthetic-business', date: '2026-08-30', closeMovements: movements }
  };
  vm.runInNewContext(`${cashIncome}\n${cashSummary}\nresult=buildCashCloseSummary({basis,cInicial:50,eFisico:70,observations:'synthetic',reportId:'synthetic-close'});`, fixture);
  const result = fixture.result;
  assert.equal(result.income, 20, 'card and transfer do not enter physical cash');
  assert.equal(result.balanceCalculado, 70, 'opening 50 plus cash sale 20');
  assert.equal(result.salesEfectivo, 20);
  assert.equal(result.salesTarjeta, 25);
  assert.equal(result.salesTransf, 30);
  assert.equal(result.abonosApartado, 5);
  for (const [label, amount] of [['Efectivo', 20], ['Tarjeta', 25], ['Transferencia', 30], ['Abonos Apartado', 5]]) {
    assert(result.html.includes(`<span>${label}:</span><span>$${amount.toFixed(2)}</span>`), `voucher shows ${label} ${amount}`);
  }
  return { income: result.income, expectedCash: result.balanceCalculado, cash: result.salesEfectivo, card: result.salesTarjeta, transfer: result.salesTransf, layawayPayment: result.abonosApartado };
}

(async () => {
  for (const method of ['Efectivo', 'Tarjeta', 'Transferencia', 'Apartado']) {
    for (const latencyMs of [0, 80]) {
      for (const namedDomProperty of [true, false]) {
        try { results.push({ status: 'PASS', ...(await checkoutCase(method, latencyMs, namedDomProperty)) }); }
        catch (error) { results.push({ status: 'FAIL', method, latencyMs, namedDomProperty, error: error.message }); }
      }
    }
  }
  try { results.push({ status: 'PASS', case: 'actual-cash-summary', ...closingCase() }); }
  catch (error) { results.push({ status: 'FAIL', case: 'actual-cash-summary', error: error.message }); }
  for (const commitMode of ['denied', 'throw']) {
    for (const method of ['Efectivo', 'Tarjeta', 'Transferencia', 'Apartado']) {
      try { results.push({ status: 'PASS', ...(await checkoutCase(method, 80, true, commitMode)) }); }
      catch (error) { results.push({ status: 'FAIL', method, commitMode, error: error.message }); }
    }
  }
  for (const result of results) console.log(JSON.stringify(result));
  const failures = results.filter((result) => result.status === 'FAIL').length;
  console.log(`Commerce core actual-source regression: ${results.length - failures} PASS, ${failures} FAIL`);
  process.exitCode = failures ? 1 : 0;
})();
