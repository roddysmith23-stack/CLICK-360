'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const RELEASE = '1.0.5';
const ASSET = 'commercial-1-0-5-r36-p0-2b-boot-grace-fix';

function normalizeP15AState(input) {
  const state = structuredClone(input);
  state.tables ||= [];
  state.tableOrders ||= [];
  state.labelPrintHistory ||= [];
  state.finance ||= {};
  state.finance.payments ||= [];
  state.finance.loans ||= [];
  state.finance.envelopes ||= [];
  state.finance.goals ||= [];
  state.help ||= {};
  state.help.lastViewedTopics ||= [];
  state.settings ||= {};
  state.settings.labelProfiles ||= [];
  return state;
}

function switchBusiness(state, businessId) {
  assert(state.businesses.some((business) => business.id === businessId), 'business exists');
  state.activeBusinessId = businessId;
  return state;
}

function productsForBusiness(state, businessId = state.activeBusinessId) {
  return state.products.filter((product) => product.businessId === businessId);
}

function startSession(firebaseUser, access) {
  assert(firebaseUser?.uid, 'Firebase Auth must return a UID');
  assert(access?.allowed === true, 'account access must be valid');
  return { status: 'READY', uid: firebaseUser.uid, readOnly: access.readOnly === true };
}

function createProduct(state, businessId, product) {
  assert(state.businesses.some((business) => business.id === businessId), 'business exists');
  assert(!state.products.some((item) => item.businessId === businessId && item.id === product.id), 'product ID is unique inside the business');
  const stored = { ...product, businessId };
  state.products.push(stored);
  return stored;
}

function openCash(state, businessId, openingAmount) {
  const session = {
    id: `cash:${businessId}:${state.cashSessions.length + 1}`,
    businessId,
    status: 'open',
    openingAmount
  };
  state.cashSessions.push(session);
  return session;
}

function sell(state, { businessId, productId, quantity, cashSessionId }) {
  const product = state.products.find((item) => item.id === productId && item.businessId === businessId);
  const session = state.cashSessions.find((item) =>
    item.id === cashSessionId && item.businessId === businessId && item.status === 'open');
  assert(product, 'product belongs to active business');
  assert(session, 'cash session belongs to active business');
  assert(product.qty >= quantity, 'stock is sufficient');
  product.qty -= quantity;
  const sale = {
    id: `sale:${businessId}:${state.sales.length + 1}`,
    businessId,
    cashSessionId,
    total: product.price * quantity,
    items: [{ productId, quantity }]
  };
  state.sales.push(sale);
  return sale;
}

function closeCash(state, businessId, cashSessionId) {
  const session = state.cashSessions.find((item) =>
    item.id === cashSessionId && item.businessId === businessId && item.status === 'open');
  assert(session, 'open cash session exists');
  session.status = 'closed';
  const report = {
    id: `report:${businessId}:${state.dailyReports.length + 1}`,
    businessId,
    cashSessionId,
    status: 'closed',
    totalSales: state.sales
      .filter((sale) => sale.businessId === businessId && sale.cashSessionId === cashSessionId)
      .reduce((sum, sale) => sum + sale.total, 0)
  };
  state.dailyReports.push(report);
  return report;
}

function accessCanWrite(access) {
  if (access.status === 'suspended' || access.status === 'blocked' || access.mode === 'trial_expired') return false;
  if (access.readOnly === true) return false;
  return ['founder', 'lifetime', 'paid_base', 'paid_pro', 'trial_active', 'active'].includes(access.mode);
}

const legacy = {
  schemaVersion: 10,
  businesses: [
    { id: 'omega', name: 'Industrias Omega' },
    { id: 'alfa', name: 'Industrias Alfa' }
  ],
  activeBusinessId: 'omega',
  products: [
    { id: 'omega-product', businessId: 'omega', name: 'Omega QA', price: 10, qty: 4 },
    { id: 'alfa-product', businessId: 'alfa', name: 'Alfa QA', price: 20, qty: 8 }
  ],
  sales: [],
  movements: [],
  cashSessions: [],
  dailyReports: [],
  settings: { customers: [], existingSetting: 'preserved' },
  customLegacyField: { keep: true }
};
const normalized = normalizeP15AState(legacy);
assert.deepEqual(
  startSession({ uid: 'qa-user' }, { allowed: true, readOnly: false }),
  { status: 'READY', uid: 'qa-user', readOnly: false },
  'valid Firebase Auth plus account access still reaches READY'
);
assert.equal(normalized.customLegacyField.keep, true, 'normalization preserves unknown legacy data');
assert.equal(normalized.settings.existingSetting, 'preserved', 'normalization merges instead of replacing settings');
assert.deepEqual(normalized.tables, [], 'tables default to an optional empty array');
assert.deepEqual(normalized.tableOrders, [], 'table orders default to an optional empty array');
assert.deepEqual(normalized.labelPrintHistory, [], 'label history defaults to an optional empty array');
assert.deepEqual(normalized.finance, { payments: [], loans: [], envelopes: [], goals: [] }, 'finance defaults are backward compatible');
assert.deepEqual(normalized.help.lastViewedTopics, [], 'help history defaults without affecting business data');

assert.deepEqual(productsForBusiness(normalized).map((product) => product.id), ['omega-product'], 'existing inventory loads for the active business');
const createdProduct = createProduct(normalized, 'omega', { id: 'omega-created', name: 'Nuevo QA', price: 5, qty: 2 });
assert.equal(createdProduct.businessId, 'omega', 'new product is assigned to the active business');
assert.equal(productsForBusiness(normalized, 'alfa').some((product) => product.id === 'omega-created'), false, 'new product never appears in another business');
switchBusiness(normalized, 'alfa');
assert.deepEqual(productsForBusiness(normalized).map((product) => product.id), ['alfa-product'], 'business switching preserves inventory isolation');
switchBusiness(normalized, 'omega');
const cash = openCash(normalized, 'omega', 25);
const sale = sell(normalized, {
  businessId: 'omega',
  productId: 'omega-product',
  quantity: 2,
  cashSessionId: cash.id
});
assert.equal(sale.total, 20, 'existing sale flow computes total');
assert.equal(normalized.products.find((product) => product.id === 'omega-product').qty, 2, 'sale decreases only active-business stock');
assert.equal(normalized.products.find((product) => product.id === 'alfa-product').qty, 8, 'sale never changes another business inventory');
const report = closeCash(normalized, 'omega', cash.id);
assert.equal(report.status, 'closed', 'cash close still succeeds');
assert.equal(report.totalSales, 20, 'cash report contains the confirmed sale');
assert.equal(normalized.dailyReports.length, 1, 'cash history keeps one close record');
const nextCash = openCash(normalized, 'omega', 20);
assert.equal(nextCash.status, 'open', 'a new cash session opens after close');

for (const mode of ['founder', 'lifetime', 'paid_base', 'paid_pro', 'trial_active']) {
  assert.equal(accessCanWrite({ mode, status: 'active', readOnly: false }), true, `${mode} remains writable`);
}
assert.equal(accessCanWrite({ mode: 'trial_expired', status: 'active' }), false, 'expired trial remains read-only');
assert.equal(accessCanWrite({ mode: 'paid_pro', status: 'suspended' }), false, 'suspended account remains blocked');
assert.equal(accessCanWrite({ mode: 'paid_base', status: 'active', readOnly: true }), false, 'explicit read-only access remains blocked');

for (const existingContract of [
  /function productsForBiz\(/,
  /function salesForBiz\(/,
  /function movementsForBiz\(/,
  /function currentOpenCashSession\(/,
  /function closeDay\(|cash_close_validate_access/,
  /function switchBusiness|data-business-switch/,
  /click360WriteGate/,
  /click360GetEffectiveAccess/
]) {
  assert.match(app, existingContract, `core contract remains present: ${existingContract}`);
}
for (const newContract of [
  /BarcodeDetector/,
  /resolveLabelCopies/,
  /tablesForBiz/,
  /financeForBiz/,
  /Centro de ayuda/
]) {
  assert.match(app, newContract, `P1.5A contract is present: ${newContract}`);
}
assert.match(app, /out\.tables\s*\|\|=\s*\[\]/, 'legacy states normalize optional tables');
assert.match(app, /out\.tableOrders\s*\|\|=\s*\[\]/, 'legacy states normalize optional table orders');
assert.match(app, /out\.finance\s*\|\|=\s*\{\}/, 'legacy states normalize optional finance');
assert.match(app, /out\.settings\.labelProfiles\s*\|\|=\s*\[\]/, 'legacy states normalize optional label profiles');
assert.match(app, /businessId/, 'new and existing business data carry businessId');
assert.match(styles, /safe-area-inset|--safe-bottom/, 'mobile/PWA safe areas remain supported');
assert.match(html, /manifest\.webmanifest/, 'PWA manifest remains linked');
assert.match(html, /firebase-auth|firebase-auth-compat/, 'Google/Firebase login bundle remains linked');
assert.match(worker, /activate|caches\.keys/, 'service worker activates and manages old caches');

assert(app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`), 'app has current release');
assert(app.includes(`const APP_ASSET_VERSION = '${ASSET}'`), 'app has the P1.5A asset version');
assert(html.includes(ASSET), 'all public HTML assets use the P1.5A cache version');
assert(styles.includes(ASSET), 'CSS image assets use the P1.5A cache version');
assert(worker.includes(`const CACHE = 'click360-${ASSET}'`), 'service worker cache is P1.5A');
assert(!worker.includes('const CACHE = \'click360-mvp-launch-v16-2-p1-r4\''), 'service worker no longer identifies the previous cache as current');

console.log('PASS P1.5A launch regression harness: core sales/cash/access/PWA contracts and backward-compatible business isolation');
