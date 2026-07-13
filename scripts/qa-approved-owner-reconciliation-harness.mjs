import assert from 'node:assert/strict';
import { normalizeOwnerAccessAssessment } from './lib/click360-owner-access-core.mjs';

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

const rejected = normalizeOwnerAccessAssessment({
  uid,
  approvedUser: { status: 'active', role: 'owner', email: 'other@example.com' },
  authUser: { uid, email: 'owner@example.com', disabled: false },
  stateDocument
});
assert.equal(rejected.action, 'BLOCKED');
assert.ok(rejected.reasons.includes('approved_email_mismatch'));

console.log('qa-approved-owner-reconciliation: PASS');
