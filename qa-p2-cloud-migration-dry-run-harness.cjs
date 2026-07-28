'use strict';

const assert = require('node:assert/strict');
const { buildP2CloudMigrationDryRun } = require('./p2-cloud-migration-dry-run.cjs');

const input = Object.freeze({
  businessId: 'biz-migration-qa',
  legacyStateMain: { schemaVersion: 10, marker: 'synthetic-only' },
  localMembers: [
    { uid: 'owner-migration-qa', businessId: 'biz-migration-qa', role: 'owner', status: 'active' },
    { id: 'invite-migration-qa', businessId: 'biz-migration-qa', email: 'worker@p2-qa.invalid', status: 'pending' }
  ],
  liteTables: [{ id: 'table-migration-qa', businessId: 'biz-migration-qa', name: 'Mesa QA', status: 'free' }],
  labelProfiles: [{ id: 'profile-migration-qa', businessId: 'biz-migration-qa', deviceScope: 'synthetic-device' }],
  routes: [{ id: 'route-migration-qa', businessId: 'biz-migration-qa', status: 'planned' }]
});

const first = buildP2CloudMigrationDryRun(input);
const second = buildP2CloudMigrationDryRun(input);
assert.equal(first.status, 'DRY_RUN_READY');
assert.equal(first.noWrites, true);
assert.equal(first.planHash, second.planHash, 'dry run must be idempotent');
assert.equal(first.target.find((entry) => entry.name === 'memberships').count, 1);
assert.equal(first.target.find((entry) => entry.name === 'invitations').count, 1);
assert.ok(first.source.some((entry) => entry.name.endsWith('/state/main')), 'legacy state is hashed as protected input');

const ambiguous = buildP2CloudMigrationDryRun({
  ...input,
  localMembers: [{ uid: 'owner-migration-qa', businessId: 'other-business', role: 'owner', status: 'active' }]
});
assert.equal(ambiguous.status, 'ABORTED_AMBIGUOUS');
assert.equal(ambiguous.noWrites, true);
assert.ok(ambiguous.errors.includes('localMembers_cross_business'));
console.log('P2 cloud migration dry-run harness: PASS');
