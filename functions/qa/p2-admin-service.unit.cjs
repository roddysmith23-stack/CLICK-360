'use strict';

const assert = require('node:assert/strict');
const { ACTIONS, P2Error, ROLE_PERMISSIONS } = require('../src/p2-admin-service.cjs');

assert.equal(ACTIONS.has('inviteWorker'), true);
assert.equal(ACTIONS.has('updateBusinessModules'), true);
assert.equal(ACTIONS.has('unsupportedAction'), false);
assert.equal(Array.isArray(ROLE_PERMISSIONS.owner), true);
assert.equal(ROLE_PERMISSIONS.server.includes('orders.create'), true);
assert.equal(ROLE_PERMISSIONS.server.includes('cash.close'), false);
assert.equal(new P2Error('qa').code, 'qa');
console.log('P2 admin service unit: PASS');
