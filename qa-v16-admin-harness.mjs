import assert from 'node:assert/strict';
import {
  activationConfirmation,
  activationFields,
  assertAdminScope,
  firestoreHash,
  stateIdentitySummary,
  suspendConfirmation
} from './scripts/lib/click360-v16-admin-core.mjs';

const authUser = { uid: 'uid-shary', email: 'shary10mmvv@gmail.com', displayName: 'SHARY', disabled: false };
const scope = assertAdminScope({
  projectId: 'click-360', actorEmail: 'roddysmithceo@gmail.com', authUser,
  expectedUid: 'uid-shary', expectedEmail: 'shary10mmvv@gmail.com', businessId: 'uid-shary'
});
assert.equal(scope.allowed, true);
assert.equal(assertAdminScope({ ...scope, projectId: 'xyfi-6b90e', actorEmail: 'roddysmithceo@gmail.com', authUser, expectedUid: authUser.uid, expectedEmail: authUser.email, businessId: authUser.uid }).allowed, false);
assert.equal(assertAdminScope({ projectId: 'click-360', actorEmail: 'attacker@example.com', authUser, expectedUid: authUser.uid, expectedEmail: authUser.email, businessId: authUser.uid }).allowed, false);
assert.equal(assertAdminScope({ projectId: 'click-360', actorEmail: 'roddysmithceo@gmail.com', authUser: { ...authUser, uid: 'demo-click360' }, expectedUid: 'demo-click360', expectedEmail: authUser.email, businessId: 'demo-click360' }).allowed, false);
assert.equal(assertAdminScope({ projectId: 'click-360', actorEmail: 'roddysmithceo@gmail.com', authUser, expectedUid: authUser.uid, expectedEmail: 'shary10mmv@gmail.com', businessId: authUser.uid }).allowed, false);

const fields = activationFields({ existing: { revision: 3 }, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'base', period: 'historical' });
assert.equal(fields.status, 'paid_base');
assert.equal(fields.source, 'historical_buyer_recovery');
assert.equal(fields.revision, 4);
assert.equal(fields.businessId, authUser.uid);
assert.equal(fields.businessLimit, 1);
assert.equal(fields.workerLimit, 2);
assert.throws(() => activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'pro', period: 'lifetime' }));
assert.equal(activationConfirmation(authUser.uid, 'base', 'historical'), 'ACTIVATE:uid-shary:BASE:HISTORICAL');
assert.equal(suspendConfirmation(authUser.uid), 'SUSPEND:uid-shary');
assert.equal(firestoreHash({ b: 2, a: 1 }), firestoreHash({ a: 1, b: 2 }));

const tenant = {
  schemaVersion: 10, ownerUid: authUser.uid, ownerId: authUser.uid, businessId: authUser.uid,
  tenantKey: `owner:${authUser.uid}:business:${authUser.uid}`,
  payload: {
    schemaVersion: 10,
    identity: { ownerUid: authUser.uid, ownerId: authUser.uid, businessId: authUser.uid, tenantKey: `owner:${authUser.uid}:business:${authUser.uid}` },
    data: { businesses: [{}], products: [], sales: [], movements: [], invoices: [], dailyReports: [], settings: { workers: [], labelTemplates: [] } }
  }
};
assert.equal(stateIdentitySummary(tenant, authUser.uid).valid, true);
assert.equal(stateIdentitySummary(tenant, authUser.uid).counts.businesses, 1);
assert.equal(stateIdentitySummary(tenant, 'other').valid, false);

console.log('OK V16 secure administration harness: project, actor, UID/email, demo lock, confirmations, backup hash and activation contract.');
