import assert from 'node:assert/strict';
import { normalizeOwnerAccessAssessment } from '../lib/click360-owner-access-core.mjs';

const uid = 'owner-a';
const stateDocument = {
  schemaVersion: 10,
  ownerUid: uid,
  ownerId: uid,
  businessId: uid,
  tenantKey: `owner:${uid}:business:${uid}`,
  payload: {
    schemaVersion: 10,
    identity: { schemaVersion: 10, ownerUid: uid, ownerId: uid, businessId: uid, tenantKey: `owner:${uid}:business:${uid}` },
    data: { businesses: [{ id: 'business-a' }], products: [], sales: [], movements: [], invoices: [], dailyReports: [], deletedProducts: [], auditLogs: [], settings: { workers: [], labelTemplates: [] } }
  }
};

const legacyOwner = normalizeOwnerAccessAssessment({
  uid,
  approvedUser: { status: 'active', role: 'owner' },
  authUser: { uid, email: 'owner@example.com', disabled: false },
  stateDocument
});
assert.equal(legacyOwner.action, 'NORMALIZATION_REQUIRED');
assert.deepEqual(legacyOwner.patch, { approved: true, ownerId: uid });

const normalized = normalizeOwnerAccessAssessment({
  uid,
  approvedUser: { status: 'active', role: 'owner', approved: true, ownerId: uid },
  authUser: { uid, email: 'owner@example.com', disabled: false },
  stateDocument
});
assert.equal(normalized.action, 'ALREADY_NORMALIZED');

const staleEmail = normalizeOwnerAccessAssessment({
  uid,
  approvedUser: { status: 'active', role: 'owner', email: 'other@example.com' },
  authUser: { uid, email: 'owner@example.com', disabled: false },
  stateDocument
});
assert.equal(staleEmail.action, 'NORMALIZATION_REQUIRED');
assert.ok(staleEmail.observations.includes('approved_email_mismatch_preserved'));

const disabled = normalizeOwnerAccessAssessment({
  uid,
  approvedUser: { status: 'active', role: 'owner' },
  authUser: { uid, email: 'owner@example.com', disabled: true },
  stateDocument
});
assert.equal(disabled.action, 'BLOCKED');
assert.ok(disabled.reasons.includes('auth_user_disabled'));

console.log('qa-approved-owner-reconciliation: PASS');
