#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const context = {
  console,
  crypto: webcrypto,
  TextEncoder,
  Date,
  Uint8Array,
  Math,
  Object,
  Array,
  Set,
  String,
  Number,
  Boolean,
  RegExp,
  Error
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync('p2-platform-domain.js', 'utf8'), context, { filename: 'p2-platform-domain.js' });

const P = context.CLICK360_P2_PLATFORM;
const businessA = { id: 'biz-alpha', settings: { modules: { workers: true, restaurant: true, logistics: true } } };
const businessB = { id: 'biz-bravo', settings: { modules: { workers: true } } };
const flags = {
  workerAccessEnabled: { key: 'workerAccessEnabled', enabled: true, allowedBusinessIds: ['biz-alpha'], rolloutPercentage: 100 },
  restaurantAdvancedEnabled: { key: 'restaurantAdvancedEnabled', enabled: true, allowedBusinessIds: ['biz-alpha'], rolloutPercentage: 100 },
  logisticsEnabled: { key: 'logisticsEnabled', enabled: true, allowedBusinessIds: ['biz-alpha'], rolloutPercentage: 100 }
};
const owner = P.normalizeMembership({ id: 'owner-alpha', uid: 'owner-alpha', businessId: 'biz-alpha', roleId: 'owner', status: 'active' });
const admin = P.normalizeMembership({ id: 'admin-alpha', uid: 'admin-alpha', businessId: 'biz-alpha', roleId: 'admin', status: 'active' });

function resolve({ access = { status: 'active', plan: 'pro' }, business = businessA, membership = owner, featureFlags = flags, uid = membership.uid } = {}) {
  return P.resolveEnabledModules({ accountAccess: access, business, membership, featureFlags, device: { uid, environment: 'local' } });
}

async function expectReject(fn, code) {
  await assert.rejects(fn, (error) => error && error.message === code);
}

(async () => {
  const ownerResolution = resolve();
  assert.equal(ownerResolution.modules.core, true, 'core is always available to an active owner');
  assert.equal(ownerResolution.modules.workers, true, 'workers requires the configured per-business flag');
  assert.equal(ownerResolution.modules.restaurant, true, 'restaurant is enabled only for the allowlisted business');
  assert.equal(ownerResolution.modules.logistics, true, 'logistics is enabled only for the allowlisted business');
  assert.equal(P.can(ownerResolution, 'members.manage'), true, 'owner can manage members');
  assert.equal(P.can(ownerResolution, 'cash.close'), true, 'owner keeps cash permissions');

  const inventoryDisabled = resolve({ business: { id: 'biz-alpha', settings: { modules: { inventory: false, workers: true, restaurant: true, logistics: true } } } });
  assert.equal(inventoryDisabled.modules.inventory, false, 'an explicit business-level module disable overrides the default');
  assert.equal(P.can(inventoryDisabled, 'inventory.write'), false, 'disabled modules remove their matching permissions');

  const adminResolution = resolve({ membership: admin, uid: 'admin-alpha' });
  assert.equal(P.can(adminResolution, 'members.manage'), true, 'an authorized admin can manage lower-privilege members');

  const otherBusiness = resolve({ business: businessB });
  assert.equal(otherBusiness.modules.workers, false, 'a feature flag never leaks into another business');
  assert.equal(P.assertBusinessScope({ businessId: 'biz-alpha', membership: owner, uid: 'owner-alpha' }), true);
  assert.equal(P.assertBusinessScope({ businessId: 'biz-bravo', membership: owner, uid: 'owner-alpha' }), false, 'cross-business access is denied');
  assert.equal(P.assertBusinessScope({ businessId: 'biz-alpha', membership: owner, uid: 'forged-uid' }), false, 'forged UID is denied');

  const suspended = resolve({ access: { status: 'suspended', plan: 'pro' } });
  assert.equal(suspended.readOnly, true, 'suspended access becomes read-only');
  assert.equal(P.can(suspended, 'inventory.write'), false, 'suspended accounts cannot write inventory');
  assert.equal(P.can(suspended, 'members.manage'), false, 'suspended accounts cannot manage members');

  const cashier = resolve({ membership: P.normalizeMembership({ uid: 'cashier-alpha', businessId: 'biz-alpha', roleId: 'cashier', status: 'active' }), uid: 'cashier-alpha' });
  assert.equal(P.can(cashier, 'sales.create'), true, 'cashier can sell');
  assert.equal(cashier.modules.workers, false, 'a cashier cannot receive the team module merely because the feature is enabled');
  assert.equal(cashier.reasons.includes('workers_role_denied'), true, 'the resolver explains the worker-module denial without pretending the flag is off');
  assert.equal(P.can(cashier, 'members.manage'), false, 'cashier cannot manage members');
  assert.equal(P.can(cashier, 'inventory.write'), false, 'cashier cannot alter inventory');
  const kitchen = resolve({ membership: P.normalizeMembership({ uid: 'kitchen-alpha', businessId: 'biz-alpha', roleId: 'kitchen', status: 'active' }), uid: 'kitchen-alpha' });
  assert.equal(P.can(kitchen, 'kitchen.read'), true, 'kitchen role reads KDS');
  assert.equal(P.can(kitchen, 'cash.read'), false, 'kitchen role cannot read cash');

  const created = await P.createInvitation({ businessId: 'biz-alpha', email: 'worker@example.test', roleId: 'seller', invitedBy: 'owner-alpha', now: 1_700_000_000_000 });
  assert.match(created.token, /^[a-f0-9]{48}$/);
  assert.equal(JSON.stringify(created.invitation).includes(created.token), false, 'the persisted invitation never contains the raw token');
  assert.equal(created.invitation.roleId, 'seller');
  assert.equal(created.invitation.status, 'pending');
  await expectReject(() => P.redeemInvitation({ invitation: created.invitation, token: created.token, uid: 'worker-alpha', email: 'wrong@example.test', now: 1_700_000_000_100 }), 'invitation_email_mismatch');
  await expectReject(() => P.redeemInvitation({ invitation: created.invitation, token: created.token, uid: 'worker-alpha', email: 'worker@example.test', now: 1_800_000_000_000 }), 'invitation_expired');
  const redeemed = await P.redeemInvitation({ invitation: created.invitation, token: created.token, uid: 'worker-alpha', email: 'worker@example.test', now: 1_700_000_000_100 });
  assert.equal(redeemed.invitation.status, 'accepted');
  assert.equal(redeemed.membership.status, 'active');
  assert.equal(redeemed.membership.businessId, 'biz-alpha');

  const adminUpdate = P.updateMembership({ actor: admin, target: redeemed.membership, roleId: 'seller', status: 'suspended' });
  assert.equal(adminUpdate.status, 'suspended', 'an authorized admin can manage a lower-privilege worker');
  assert.throws(() => P.updateMembership({ actor: admin, target: redeemed.membership, roleId: 'owner' }), /owner_escalation_forbidden/, 'an admin cannot promote a worker to owner');
  assert.throws(() => P.updateMembership({ actor: admin, target: admin, status: 'suspended' }), /admin_peer_or_owner_manage_forbidden/, 'an admin cannot manage an admin peer');
  assert.throws(() => P.updateMembership({ actor: owner, target: redeemed.membership, roleId: 'owner' }), /owner_escalation_forbidden/, 'workers cannot self-escalate to owner');
  const revoked = P.updateMembership({ actor: owner, target: redeemed.membership, status: 'revoked', now: 1_700_000_000_200 });
  assert.equal(revoked.status, 'revoked');
  const revokedResolution = resolve({ membership: revoked, uid: 'worker-alpha' });
  assert.equal(revokedResolution.modules.core, true, 'a revoked identity only gets the neutral core shell');
  assert.equal(P.can(revokedResolution, 'sales.create'), false, 'revoked users cannot create sales');

  const audit = P.auditEvent('worker_invited', { invitationId: 'invite-safe', token: created.token, password: 'never-record', businessId: 'biz-alpha' });
  assert.equal('token' in audit.details, false, 'audit data strips secrets');
  assert.equal('password' in audit.details, false, 'audit data strips passwords');
  assert.equal(audit.details.businessId, 'biz-alpha');

  console.log('P2 platform/modules/workers harness: PASS');
})().catch((error) => {
  console.error('P2 platform/modules/workers harness: FAIL');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
