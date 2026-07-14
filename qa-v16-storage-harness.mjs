import assert from 'node:assert/strict';

await import('./v16-storage.js');
const storage = globalThis.CLICK360_V16_STORAGE;
assert(storage, 'V16 storage module must load');

const a = { authUid: 'uid-a', ownerId: 'uid-a', businessId: 'uid-a', tenantKey: 'owner:uid-a:business:uid-a' };
const b = { authUid: 'uid-b', ownerId: 'uid-b', businessId: 'uid-b', tenantKey: 'owner:uid-b:business:uid-b' };
assert.notEqual(storage.contextId(a), storage.contextId(b));
assert.match(storage.contextId(a), /^uid-a:owner:uid-a:business:uid-a$/);
assert.throws(() => storage.contextId({ authUid: 'uid-a' }), /incompleto/i);
await assert.rejects(storage.probe(), (error) => error?.code === 'indexeddb-unavailable');
assert.equal(await storage.estimate(), null);
console.log('PASS V16 storage: exact UID/tenant namespaces and safe IndexedDB-unavailable fallback');
