/**
 * Phase 3.4c: regression lock for three P0/P1 defects found via LIVE staging
 * verification (real browser + custom-token worker login), not unit tests:
 *
 *  1. A 'seller' worker could not complete ANY cash sale/layaway with a
 *     non-zero amount ("Permiso denegado: movements.create"), because the
 *     seller role lacked movements.create even though app.js always writes
 *     an ingreso movement whenever movAmount > 0 -- which is true for every
 *     normal paid sale, not just Apartados with an abono.
 *  2. A 'seller'/'cashier' worker could not sell a REAL inventory item at all
 *     ("Permiso denegado: products.update"), because app.js stamps
 *     `updatedBy` on every product whose stock changes during checkout, but
 *     the boundary's onlyStock allowlist (the exception that lets a plain
 *     sales.create actor bump stock without full products.update) only
 *     recognized stock/updatedAt/updatedAtMs -- so the extra changed key
 *     forced a fall-through to the full products.update permission check.
 *  3. Any non-owner role (worker/seller/supervisor/cashier) clicking the
 *     "Apartados" button got silently redirected to #home, even when their
 *     modular permissions granted layaways.read -- because can('debtors')
 *     had no routeModule/boundaryModule mapping for the 'debtors' section
 *     and none of the legacy per-role fallbacks listed it either.
 */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const boundarySource = fs.readFileSync('worker-data-boundary.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(boundarySource, context, { filename: 'worker-data-boundary.js' });
const api = context.globalThis.CLICK360_WORKER_DATA_BOUNDARY;
assert(api, 'worker data boundary API must be published');

// ── Defect 1: seller must be able to create movements (every paid sale writes one) ──
const sellerMap = api.normalizePermissionMap('seller');
assert(sellerMap.movements.create === true, 'seller role must have movements.create -- every completed sale/layaway with movAmount > 0 writes an ingreso movement, including plain cash sales, not just Apartados');
assert(sellerMap.movements.read === true, 'seller role must retain movements.read');

// ── Defect 2: the sale-time stock exception must tolerate every field app.js actually stamps on checkout (stock, qty, updatedAt, updatedAtMs, updatedBy) ──
assert(/onlyStock = \[\.\.\.changedKeys\]\.every\(\(key\) => \['stock', 'qty', 'updatedAt', 'updatedAtMs', 'updatedBy'\]\.includes\(key\)\)/.test(boundarySource),
  'the sale_stock exception allowlist must include stock, qty, updatedAt, updatedAtMs and updatedBy -- app.js always stamps p.qty = p.stock alongside stock on every checkout, so omitting qty forces a spurious fall-through to the full products.update permission for every worker sale of a real inventory item');
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert(/"stock", "qty", "updatedAtMs", "lastOperationId", "recordVersion", "updatedBy", "updatedAt"/.test(rules),
  'firestore.rules server-side mirror of the sale_stock exception must also allow qty -- the client-side allowlist fix alone is not sufficient, since Firestore Rules independently re-validates affectedKeys() and would otherwise reject the exact same write');

// ── Defect 3: can('debtors') must resolve via the modular layaways permission, not just legacy fallback lists ──
assert(/routeModule = \{[^}]*debtors: 'layaways'[^}]*\}\[section\]/.test(app), "can()'s routeModule map must include debtors:'layaways'");
assert(/boundaryModule = \{[^}]*debtors:'layaways'[^}]*\}\[section\]/.test(app), "can()'s boundaryModule map must include debtors:'layaways' so permissions['layaways']?.read gates the route");
assert(/role === 'worker'\) return \[[^\]]*'debtors'[^\]]*\]\.includes\(section\)/.test(app), "legacy 'worker' role fallback must include 'debtors' (matches its own bottom-nav entry)");
assert(/role === 'seller'\) return \[[^\]]*'debtors'[^\]]*\]\.includes\(section\)/.test(app), "legacy 'seller' role fallback must include 'debtors'");
assert(/role === 'cashier'\) return \[[^\]]*'debtors'[^\]]*\]\.includes\(section\)/.test(app), "legacy 'cashier' role fallback must include 'debtors' (matches its own bottom-nav entry)");

// ── Regression: a role with NO layaways.read (inventory) must still be denied the debtors route ──
const inventoryMap = api.normalizePermissionMap('inventory');
assert(inventoryMap.layaways === undefined || inventoryMap.layaways.read !== true, "the 'inventory' role must not gain layaways.read as a side effect of this fix -- it has no layaways permissions at all, so can('debtors') must still deny it via permissions['layaways']?.read");

// ── Defensive fix: the sell-view cash-change field write must not throw when the DOM node is gone ──
assert(/if \(\$\('#cashChange'\)\) \$\('#cashChange'\)\.value = fmt\(rec - total\)/.test(app), 'cashChange update on Efectivo must null-guard the DOM lookup (observed live: "Cannot set properties of null" pageerror from a stray post-navigation callback)');

console.log('PASS Phase 3.4c live-verification fixes: seller movements.create, sale_stock updatedBy allowlist, debtors route gate (structural regression against worker-data-boundary.js + app.js)');
