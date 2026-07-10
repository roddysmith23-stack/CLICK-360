const assert = require('assert');
require('./p0-tenant-guard.js');
const guard = global.CLICK360_P0_TENANT_GUARD;

const A = { authUid: 'uid-a', ownerId: 'owner-a', businessId: 'business-a', tenantKey: 'owner:owner-a:business:business-a' };
const B = { authUid: 'uid-b', ownerId: 'owner-b', businessId: 'business-b', tenantKey: 'owner:owner-b:business:business-b' };
const storage = new Map();
const stateKey = (tenant) => `CLICK360_STATE:${tenant.tenantKey}`;

function status(tenant) {
  const raw = storage.get(stateKey(tenant));
  if (!raw || storage.get(`CLICK360_TENANT:${tenant.tenantKey}:CORRUPT`) || storage.get(`CLICK360_TENANT:${tenant.tenantKey}:LEGACY_MIGRATION_REQUIRED`)) return false;
  try {
    const state = JSON.parse(raw);
    return state.identity?.ownerId === tenant.ownerId && state.identity?.businessId === tenant.businessId && state.identity?.tenantKey === tenant.tenantKey;
  } catch { return false; }
}
function save(tenant, code) { storage.set(stateKey(tenant), JSON.stringify({ identity: tenant, products: [{ code }] })); }
function offlineEntry(tenant) { const gate = guard.createSyncGate(); gate.begin(tenant); if (status(tenant)) gate.allow(tenant); return gate.canUnlock(tenant); }

save(A, 'A-001');
assert(offlineEntry(A), 'A with valid cache enters offline');
assert(!offlineEntry(B), 'B without cache remains blocked');
assert(!status(B), 'B never receives A cache');
save(B, 'B-001');
assert(offlineEntry(B), 'B with its own cache enters offline');
assert.strictEqual(JSON.parse(storage.get(stateKey(A))).products[0].code, 'A-001');
assert.strictEqual(JSON.parse(storage.get(stateKey(B))).products[0].code, 'B-001');
storage.set(`CLICK360_TENANT:${A.tenantKey}:LEGACY_MIGRATION_REQUIRED`, '1');
assert(!offlineEntry(A), 'legacy-pending tenant remains blocked offline');
storage.delete(`CLICK360_TENANT:${A.tenantKey}:LEGACY_MIGRATION_REQUIRED`);
storage.set(stateKey(B), JSON.stringify({ identity: A, products: [{ code: 'A-001' }] }));
assert(!offlineEntry(B), 'foreign tenant cache remains blocked');
console.log('PASS P0 offline cache validation and cross-tenant blocking');
