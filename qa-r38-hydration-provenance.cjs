'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('app.js', 'utf8');
function functionSource(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start + 1);
  assert(start > 0 && end > start);
  return source.slice(start, end).trim();
}
// Real view implementations: an accidental commercial data read while pending
// throws, so a zero-valued synthetic fallback cannot silently pass this test.
const pending = {
  tenantDataHydrated: false,
  authUser: () => ({ name: 'Synthetic operator' }), escapeHtml: String,
  dataNotReadyCardHtml: message => `<section role="status">${message}</section>`,
  currentBusiness: () => { throw new Error('read business before hydration'); },
  productsForBiz: () => { throw new Error('read inventory before hydration'); },
  salesForBiz: () => { throw new Error('read sales before hydration'); },
  movementsForBiz: () => { throw new Error('read money before hydration'); },
};
vm.createContext(pending);
// Extract complete declarations up to their next named sibling. vm parses the
// entire implementation, so an incomplete function is a hard test failure.
const functions = new Map([
  ['homeView', 'inventoryView'], ['inventoryView', 'refreshInventoryTemplateSection'],
  ['sellView', 'dataNotReadyCardHtml'], ['cashView', 'labelKind'],
  ['reportsView', 'debtorsView'], ['shell', 'primaryRouteKeys'],
].map(([name, next]) => [name, functionSource(name, next)]));
for (const name of ['homeView', 'inventoryView', 'sellView', 'cashView', 'reportsView']) {
  assert(functions.has(name));
  vm.runInContext(functions.get(name), pending);
  const html = pending[name]();
  assert.match(html, /Cargando|sincronizando/i, `${name}: visible non-final loading state`);
  assert.doesNotMatch(html, /Ventas \$0|Caja \$0|Inventario 0|Stock bajo 0|Mi Negocio/);
}
// The actual reload callback must invalidate hydration even after a previously
// successful remote snapshot if loadState() falls back to seed.
const reloadStart = source.indexOf('window.click360ReloadState = () => {');
const reloadEnd = source.indexOf("window.addEventListener('storage'", reloadStart);
assert(reloadStart > 0 && reloadEnd > reloadStart);
const reloadContext = { window: {}, state: { products: [{ id: 'qa-real' }] }, tenantDataHydrated: true,
  tenantStateProvenance: 'remote', lastLoadStateWasRealCache: false, lastAutoSaveHash: '',
  loadState: () => ({ products: [] }), rememberPersistedState() {} };
vm.createContext(reloadContext);
vm.runInContext(source.slice(reloadStart, reloadEnd), reloadContext);
reloadContext.window.click360ReloadState();
assert.equal(reloadContext.tenantDataHydrated, false);
assert.equal(reloadContext.tenantStateProvenance, 'fallback');
reloadContext.lastLoadStateWasRealCache = true;
reloadContext.window.click360ReloadState();
assert.equal(reloadContext.tenantDataHydrated, true);
assert.equal(reloadContext.tenantStateProvenance, 'verified_cache');
assert.match(functions.get('shell'), /const businessName = tenantDataHydrated \? .* : 'Cargando negocio…'/);
console.log('PASS r38 hydration: 5 real views have no false-zero reads; reload fallback invalidates hydration/provenance; header hides seed business.');
