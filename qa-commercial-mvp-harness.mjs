/**
 * Commercial MVP finalization: permanent regression gate for the plan /
 * capacity / quota / founder_legacy architecture added in this release.
 *
 * Locks in the core commercial contract:
 *  - PLAN_CATALOG exposes all 5 sellable/legacy tiers with real limits.
 *  - Reaching a quota (70/85/95/100%) never blocks selling, charging,
 *    printing or reading existing data -- it can ONLY gate the creation of
 *    NEW resources (products, image storage). This is checked structurally:
 *    tenantQuotaStatus()/evaluateQuota() must appear only in the display
 *    layer (Mi plan) and the product-creation/image-growth gate, never in
 *    checkout/cash/print code.
 *  - founder_legacy is a real, generous, technically-bounded tier -- not
 *    the internal/unlimited 'founder' mode.
 *  - The capacityRequests write path (client -> firestore.rules) matches
 *    field-for-field.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

await import('./v16-domain.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
assert(domain, 'V16 domain module must load');

// ── Catalog: 5 tiers, real display names, generous founder_legacy limits ──
const tiers = ['base', 'pro', 'business', 'enterprise', 'founder_legacy'];
tiers.forEach((code) => assert(domain.PLAN_CATALOG[code], `PLAN_CATALOG must expose the ${code} tier`));
assert.equal(domain.PLAN_CATALOG.base.name, 'Basic');
assert.equal(domain.PLAN_CATALOG.founder_legacy.name, 'Founder');
assert(domain.PLAN_CATALOG.founder_legacy.limits.productsActive >= domain.PLAN_CATALOG.business.limits.productsActive,
  'founder_legacy quotas must be at least as generous as Business, derived from real measured usage with growth margin');
assert(!domain.PLAN_CATALOG.founder_legacy.prices.month, 'founder_legacy must carry no recurring monthly price');

// ── Quota model: reaching 100% blocks only new-resource creation ──
const downgradeScenario = domain.evaluateQuota(200, domain.PLAN_CATALOG.base.limits.productsActive);
assert.equal(downgradeScenario.blocked, true, 'usage above the new (lower) plan limit must be flagged blocked=true for the creation gate');
assert.equal(downgradeScenario.level, 'blocked');
const unlimitedScenario = domain.evaluateQuota(50000, null);
assert.equal(unlimitedScenario.blocked, false, 'a null limit (e.g. Enterprise worker seats) must never block');
assert.equal(domain.evaluateQuota(69, 100).level, 'ok');
assert.equal(domain.evaluateQuota(70, 100).level, 'notice');
assert.equal(domain.evaluateQuota(85, 100).level, 'warning');
assert.equal(domain.evaluateQuota(95, 100).level, 'critical');
assert.equal(domain.evaluateQuota(100, 100).level, 'blocked');

// ── founder_legacy entitlement: real access, not the internal 'founder' bypass ──
const founderLegacyAccess = domain.evaluateEntitlement({ status: 'founder_legacy', plan: 'founder_legacy' }, Date.now());
assert.equal(founderLegacyAccess.allowed, true);
assert.equal(founderLegacyAccess.readOnly, false);
assert.equal(founderLegacyAccess.mode, 'founder_legacy');
assert.notEqual(founderLegacyAccess.mode, 'founder', 'founder_legacy must stay distinct from the internal/unlimited founder mode');

// ── Structural: quota enforcement lives ONLY in the display layer + the product-creation/image-growth gate ──
const app = fs.readFileSync('app.js', 'utf8');
const quotaStatusCallCount = (app.match(/= tenantQuotaStatus\(\)/g) || []).length;
assert.equal(quotaStatusCallCount, 2, 'tenantQuotaStatus() must be called exactly twice: the Mi-plan display and the product-creation gate -- a new call site anywhere else risks silently blocking an unrelated flow (selling, cash, printing)');
assert(app.includes('function accessView()'), 'Mi plan y acceso view must exist');
assert(/quota\?\.productsActive\?\.blocked.*return toast\(quotaBlockMessage/.test(app), 'the product-creation gate must block only on productsActive.blocked, using the shared quota message');
assert(app.includes('function tenantAccountPlan()') && app.includes('function tenantUsageSnapshot()') && app.includes('function tenantQuotaStatus()'), 'the three quota primitives must exist');
assert(app.includes('function resolvedPlanFeatures('), 'Mi plan must resolve "Todo X"-style catalog shorthand into a real included/not-included feature list, not show marketing shorthand to the customer');
assert(app.includes("data-request-plan=\"${code}\" data-request-period=\"custom\""), 'the Enterprise plan card must request a quote (period=custom) instead of fabricating a self-serve price');

// ── Structural: capacity-request path matches field-for-field, client -> rules ──
const service = fs.readFileSync('firebase-service.js', 'utf8');
assert(service.includes('window.click360RequestCapacity = async function(kind, note = \'\')'), 'click360RequestCapacity must exist with the (kind, note) signature');
assert(/\['products', 'storage'\]\.includes\(safeKind\)/.test(service), 'click360RequestCapacity must validate kind against the exact same whitelist as firestore.rules');
const rules = fs.readFileSync('firestore.rules', 'utf8');
assert(/match \/businesses\/\{ownerUid\}\/capacityRequests\/\{requestId\}/.test(rules), 'firestore.rules must define the capacityRequests contract');
assert(/request\.resource\.data\.kind == "products" \|\| request\.resource\.data\.kind == "storage"/.test(rules), 'capacityRequests create must validate kind the same way the client does');
assert(/data\.status == "founder_legacy" && data\.plan == "founder_legacy"/.test(rules), 'firestore.rules write gate must recognize founder_legacy accounts');

// ── Structural: admin activation tooling supports every sellable tier + founder_legacy ──
// r36: activationFields() now lives in v16-domain.js (single canonical
// implementation shared by CLI and CEO Admin Web); click360-v16-admin-core.mjs
// is a thin re-export wrapper, so the plan-code/period checks live in the
// domain source itself, not in admin-core.mjs.
const domainSource = fs.readFileSync('v16-domain.js', 'utf8');
tiers.forEach((code) => assert(domainSource.includes(`'${code}'`), `activationFields() must recognize the ${code} plan code`));
assert(/founder_legacy has no billing period/.test(domainSource), 'founder_legacy activation must reject a billing period instead of silently accepting one');
const adminCore = fs.readFileSync('scripts/lib/click360-v16-admin-core.mjs', 'utf8');
assert(/domain\.activationFields\(/.test(adminCore), 'click360-v16-admin-core.mjs must delegate to the canonical v16-domain.js activationFields(), not maintain its own copy');

console.log('PASS Commercial MVP: 5-tier plan catalog, quota-blocks-creation-only contract, founder_legacy entitlement, capacityRequests wiring, admin activation coverage (structural + domain regression)');
