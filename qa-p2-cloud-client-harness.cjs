'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const fetchCalls = [];
let online = false;
let failuresRemaining = 1;
const context = {
  console,
  globalThis: null,
  navigator: { get onLine() { return online; } },
  CLICK360_P2_CLOUD: { config: { enabled: true, environment: 'emulator', projectId: 'demo-click360-p2-staging', functionsOrigin: 'http://127.0.0.1:5001/demo-click360-p2-staging/us-central1' } },
  click360Auth: { currentUser: { getIdToken: async () => 'synthetic-token' } },
  fetch: async (url, options) => {
    fetchCalls.push({ url, options });
    if (failuresRemaining) { failuresRemaining -= 1; throw new Error('offline'); }
    return { ok: true, status: 200, json: async () => ({ ok: true, requestId: 'request-qa', result: { accepted: true } }) };
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('p2-cloud-client.js', 'utf8'), context, { filename: 'p2-cloud-client.js' });

const client = context.CLICK360_P2_CLOUD_CLIENT;
assert.equal(client.offlineState().status, 'offline');
assert.equal(client.offlineState().retryable, true);
online = true;
assert.equal(client.offlineState().status, 'online');
assert.equal(client.offlineState().retryable, false);

(async () => {
  await assert.rejects(client.call('createRestaurantOrder', { businessId: 'biz-alpha' }, { idempotencyKey: 'client_retry_key_001' }), /network_error/);
  const retried = await client.call('createRestaurantOrder', { businessId: 'biz-alpha' }, { idempotencyKey: 'client_retry_key_001' });
  assert.equal(retried.accepted, true);
  assert.equal(retried.idempotencyKey, 'client_retry_key_001');
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].url, fetchCalls[1].url);
  assert.equal(fetchCalls[1].options.headers.authorization, 'Bearer synthetic-token');
  console.log('P2 cloud client offline/retry harness: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
