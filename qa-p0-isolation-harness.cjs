const assert = require('assert');
const guard = require('./p0-tenant-guard.js');

const tenantA = { authUid: 'uid-a', ownerId: 'owner-a', businessId: 'business-a', tenantKey: 'owner:owner-a:business:business-a' };
const tenantB = { authUid: 'uid-b', ownerId: 'owner-b', businessId: 'business-b', tenantKey: 'owner:owner-b:business:business-b' };
const stateKey = (tenant) => `CLICK360_STATE:${tenant.tenantKey}`;
const sessionKey = (tenant) => `CLICK360_SESSION:${tenant.authUid}`;
const storage = new Map();

function writeTenant(tenant, productCode) {
  storage.set(stateKey(tenant), JSON.stringify({ identity: tenant, products: [{ code: productCode }] }));
  storage.set(sessionKey(tenant), JSON.stringify({ username: tenant.authUid }));
}
function readTenant(tenant) {
  return JSON.parse(storage.get(stateKey(tenant)) || '{"products":[]}');
}

writeTenant(tenantA, 'A-001');
for (let cycle = 0; cycle < 10; cycle += 1) {
  const b = readTenant(tenantB);
  assert(!b.products.some((product) => product.code === 'A-001'), `A leaked into B on cycle ${cycle}`);
  if (cycle === 0) writeTenant(tenantB, 'B-001');
  const a = readTenant(tenantA);
  assert(a.products.some((product) => product.code === 'A-001'), `A missing on cycle ${cycle}`);
  assert(!a.products.some((product) => product.code === 'B-001'), `B leaked into A on cycle ${cycle}`);
  const bAfter = readTenant(tenantB);
  assert(bAfter.products.some((product) => product.code === 'B-001'), `B missing on cycle ${cycle}`);
  assert(!bAfter.products.some((product) => product.code === 'A-001'), `A leaked into B on cycle ${cycle}`);
}

assert.notStrictEqual(stateKey(tenantA), stateKey(tenantB), 'tenant state keys must differ');
assert.notStrictEqual(sessionKey(tenantA), sessionKey(tenantB), 'UID session keys must differ');

(async () => {
  const syncGate = guard.createSyncGate();
  syncGate.begin(tenantA);
  assert(syncGate.requireLegacy(tenantA, { schemaVersion: 9 }), 'legacy mode must be entered for current tenant');
  assert.strictEqual(syncGate.snapshot().mode, guard.MODES.LEGACY_MIGRATION_REQUIRED);
  assert.strictEqual(syncGate.canUnlock(tenantA), false, 'legacy tenant must remain locked');
  assert.strictEqual(syncGate.canWrite(tenantA), false, 'legacy tenant must not write');

  let stateDocSetCalls = 0;
  const wroteDuringLegacy = await guard.guardedWrite(syncGate, tenantA, async () => { stateDocSetCalls += 1; });
  assert.strictEqual(wroteDuringLegacy, false, 'legacy write must be blocked');
  assert.strictEqual(stateDocSetCalls, 0, 'STATE_DOC.set must never run while legacy is unmigrated');

  assert(syncGate.startMigration(tenantA), 'only current legacy tenant can start migration');
  assert.strictEqual(syncGate.canWrite(tenantA), false, 'migration itself must not enable automatic writes');
  assert(syncGate.allow(tenantA), 'verified migration can enable the tenant');
  const wroteAfterMigration = await guard.guardedWrite(syncGate, tenantA, async () => { stateDocSetCalls += 1; });
  assert.strictEqual(wroteAfterMigration, true, 'verified tenant can write');
  assert.strictEqual(stateDocSetCalls, 1, 'one verified write expected');

  console.log('PASS P0 tenant A -> logout -> B -> logout -> A isolation (10 cycles)');
  console.log('PASS P0 legacy remote blocks unlock and STATE_DOC.set');
})();
