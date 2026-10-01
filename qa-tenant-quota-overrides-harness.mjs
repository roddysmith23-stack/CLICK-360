import assert from 'node:assert/strict';

await import('./v16-domain.js');
await import('./tenant-quota-overrides.js');
const domain = globalThis.CLICK360_V16_DOMAIN;
const quota = globalThis.CLICK360_TENANT_QUOTA;
assert(domain && quota);

const catalogBefore = structuredClone(domain.PLAN_CATALOG.founder_legacy.limits);
const overridden = quota.planEntitlements(domain, 'founder_legacy', {
  businesses:12,
  workers:40,
  productsActive:2500,
  storageBytes:30 * 1024 * 1024
});
assert.deepEqual(overridden.limits, {
  ...catalogBefore,
  businesses:12,
  workerSeatsMax:40,
  productsActive:2500,
  storageBytes:30 * 1024 * 1024
});
assert.deepEqual(domain.PLAN_CATALOG.founder_legacy.limits, catalogBefore,
  'tenant overrides must never mutate the shared catalog');
assert.deepEqual(quota.planLimits(domain, 'founder_legacy', { businesses:12, workers:40 }), { businesses:12, workers:40 });
assert.deepEqual(quota.planLimits(domain, 'founder', { businesses:12, workers:40 }), { businesses:12, workers:40 });
assert.equal(quota.planEntitlements(domain, 'base', { productsActive:-1 }).limits.productsActive, domain.PLAN_CATALOG.base.limits.productsActive);
assert.equal(quota.planEntitlements(domain, 'base', { productsActive:0 }).limits.productsActive, domain.PLAN_CATALOG.base.limits.productsActive);
assert.equal(quota.planEntitlements(domain, 'base', { productsActive:'not-a-number' }).limits.productsActive, domain.PLAN_CATALOG.base.limits.productsActive);
assert.equal(quota.planLimits(domain, 'enterprise', null).workers, 9999);
assert.equal(quota.sanitizeOverrideLimit(12.4), 12);

console.log('PASS tenant quota overrides: account-scoped limits, shared catalog immutability, invalid-value rejection and legacy gate parity');
