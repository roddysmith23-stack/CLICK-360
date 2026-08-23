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
// Basic's worker ceiling was raised 2->5 (commercial MVP: add-on revenue
// available even on the entry tier) -- see PLAN_CATALOG.base in v16-domain.js.
assert.equal(fields.workerLimit, 5);
assert.throws(() => activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'pro', period: 'lifetime' }));
assert.throws(() => activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'business', period: 'lifetime' }));
assert.throws(() => activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'unknown_tier', period: 'month' }));

const businessFields = activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'business', period: 'year' });
assert.equal(businessFields.status, 'paid_business');
assert.equal(businessFields.businessLimit, 10);
assert.equal(businessFields.workerLimit, 25);

const enterpriseFields = activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'enterprise', period: 'year' });
assert.equal(enterpriseFields.status, 'paid_enterprise');
assert.equal(enterpriseFields.businessLimit, 25);

const founderFields = activationFields({ existing: { revision: 7 }, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'founder_legacy', period: 'historical' });
assert.equal(founderFields.status, 'founder_legacy');
assert.equal(founderFields.plan, 'founder_legacy');
assert.equal(founderFields.planCode, 'founder_legacy');
assert.equal(founderFields.lifetime, false);
assert.equal(founderFields.source, 'founder_legacy_grant');
assert.equal(founderFields.businessLimit, 10);
assert.equal(founderFields.workerLimit, 25);
assert.equal(founderFields.revision, 8);
// founder_legacy is a permanent grant -- it has no billing period concept.
assert.throws(() => activationFields({ existing: {}, authUser, actorEmail: 'roddysmithceo@gmail.com', plan: 'founder_legacy', period: 'year' }));

assert.equal(activationConfirmation(authUser.uid, 'base', 'historical'), 'ACTIVATE:uid-shary:BASE:HISTORICAL');
assert.equal(activationConfirmation(authUser.uid, 'founder_legacy', 'historical'), 'ACTIVATE:uid-shary:FOUNDER_LEGACY:HISTORICAL');
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
