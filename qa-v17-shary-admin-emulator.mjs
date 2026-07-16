import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { domainCounts, stableHash } from './scripts/lib/click360-data-core.mjs';
import { firestoreHash, plainFirestoreValue } from './scripts/lib/click360-v16-admin-core.mjs';
import { executeV17Provisioning, rollbackV17Provisioning } from './scripts/lib/click360-v17-provisioning-engine.mjs';

const PROJECT_ID = 'demo-click360-v17-mirror';
const UID = 'qaMirrorV17Owner';
const EMAIL = 'qa-v17-mirror@example.test';
const ACTOR_UID = 'qaMirrorSuperAdmin';
const ACTOR_EMAIL = 'qa-v17-super-admin@example.test';
const ORG_ID = 'org_qa_v17_mirror';

function emptyState(ownerUid, businessName) {
  const tenantKey = `owner:${ownerUid}:business:${ownerUid}`;
  return {
    schemaVersion: 10,
    ownerUid,
    ownerId: ownerUid,
    businessId: ownerUid,
    tenantKey,
    revision: 1,
    payload: {
      schemaVersion: 10,
      identity: { schemaVersion: 10, ownerUid, ownerId: ownerUid, businessId: ownerUid, tenantKey },
      data: {
        businesses: [{ id: `biz_${ownerUid}`, name: businessName }],
        activeBusinessId: `biz_${ownerUid}`,
        products: [], sales: [], movements: [], invoices: [], dailyReports: [], deletedProducts: [],
        auditLogs: [], layaways: [], cashSessions: [], notifications: [], legalAcceptances: [],
        settings: { workers: [], labelTemplates: [], customers: [], reminders: [], activationRequests: [], userProfiles: {} }
      }
    }
  };
}

function desiredActions(accountBeforeHash) {
  const access = {
    platformRole: 'customer', adminLevel: null, plan: 'pro', planCode: 'pro_lifetime',
    billingStatus: 'lifetime', lifetime: true, customerTier: 'founding_customer', status: 'active',
    expiresAt: null, source: 'founding_customer_upgrade', entitlementVersion: 17
  };
  return [
    { path: `users/${UID}`, operation: 'CREATE_IF_ABSENT', desired: {
      uid: UID, email: EMAIL, administrativeEmail: '', displayName: 'Cuenta espejo QA', photoURL: '',
      platformRole: 'customer', adminLevel: null, status: 'active', modelVersion: 17
    } },
    { path: `entitlements/${UID}`, operation: 'CREATE_IF_ABSENT', desired: {
      uid: UID, ...access, primaryOrganizationId: ORG_ID, organizationLimit: 1, workerLimit: 5, modelVersion: 17
    } },
    { path: `organizations/${ORG_ID}`, operation: 'CREATE_IF_ABSENT', desired: {
      organizationId: ORG_ID, ownerUid: UID, name: 'Cuenta espejo QA', status: 'active', legacyBusinessId: UID, modelVersion: 17
    } },
    { path: `organizations/${ORG_ID}/members/${UID}`, operation: 'CREATE_IF_ABSENT', desired: {
      uid: UID, organizationId: ORG_ID, organizationRole: 'owner', status: 'active', modelVersion: 17
    } },
    { path: `userOrganizations/${UID}/organizations/${ORG_ID}`, operation: 'CREATE_IF_ABSENT', desired: {
      uid: UID, organizationId: ORG_ID, organizationRole: 'owner', status: 'active', modelVersion: 17
    } },
    { path: `subscriptions/${ORG_ID}`, operation: 'CREATE_IF_ABSENT', desired: {
      organizationId: ORG_ID, plan: 'pro', planCode: 'pro_lifetime', billingStatus: 'lifetime', lifetime: true,
      expiresAt: null, customerTier: 'founding_customer', status: 'active', workerLimit: 5, modelVersion: 17
    } },
    { path: `accountAccess/${UID}`, operation: 'MERGE_WITH_HASH_PRECONDITION', beforeHash: accountBeforeHash, desired: {
      ...access, uid: UID, email: EMAIL, administrativeEmail: '', businessId: UID, ownerId: UID,
      tenantKey: `owner:${UID}:business:${UID}`, primaryOrganizationId: ORG_ID, businessLimit: 1,
      workerLimit: 5, revision: 2, updatedAt: 'SERVER_TIMESTAMP'
    } }
  ];
}

const app = initializeApp({ projectId: PROJECT_ID }, `click360-v17-mirror-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);

try {
  await Promise.all([
    auth.createUser({ uid: UID, email: EMAIL, emailVerified: true, displayName: 'Cuenta espejo QA' }),
    auth.createUser({ uid: ACTOR_UID, email: ACTOR_EMAIL, emailVerified: true, displayName: 'QA Super Admin' })
  ]);
  await auth.setCustomUserClaims(UID, { unrelatedClaim: 'preserve-me' });

  const accountBefore = {
    uid: UID,
    email: EMAIL,
    businessId: UID,
    ownerId: UID,
    tenantKey: `owner:${UID}:business:${UID}`,
    status: 'paid_base',
    plan: 'base',
    planCode: 'base',
    trialDays: 7,
    trialStartedAt: Timestamp.fromMillis(1_783_974_459_000),
    source: 'paid_customer_recovery',
    entitlementVersion: 16,
    revision: 1
  };
  await db.doc(`accountAccess/${UID}`).create(accountBefore);
  await db.doc(`approvedUsers/${UID}`).create({ uid: UID, email: EMAIL, ownerId: UID, role: 'owner', status: 'active', approved: true });

  const tenantDocuments = [
    ['businesses/qa-protected-a/state/main', emptyState('qa-protected-a', 'Protected A')],
    ['businesses/qa-protected-b/state/main', emptyState('qa-protected-b', 'Protected B')],
    ['businesses/qa-protected-c/state/main', emptyState('qa-protected-c', 'Protected C')],
    ['businesses/demo-click360/state/main', emptyState('demo-click360', 'Blocked Demo')]
  ];
  for (const [pathValue, document] of tenantDocuments) await db.doc(pathValue).create(document);
  const tenantManifest = tenantDocuments.map(([pathValue, document]) => ({
    path: pathValue,
    hash: firestoreHash(document),
    counts: domainCounts(document.payload.data),
    businessNames: document.payload.data.businesses.map((business) => business.name),
    classification: pathValue.includes('demo-click360') ? { classification: 'cross_tenant_suspect', environment: 'blocked_demo' } : null,
    protected: true,
    writeAllowed: false
  }));
  const tenantHashesBefore = Object.fromEntries(tenantManifest.map((item) => [item.path, item.hash]));
  const targetActions = desiredActions(firestoreHash(accountBefore));
  const targetPaths = targetActions.map((action) => action.path);
  const claimsBefore = plainFirestoreValue((await auth.getUser(UID)).customClaims || {});
  const context = {
    projectId: PROJECT_ID,
    subjectKey: 'qa_mirror',
    uid: UID,
    email: EMAIL,
    organizationId: ORG_ID,
    planHash: stableHash({ qa: 'mirror-v17' }),
    sourceAuditHash: stableHash({ qa: 'audit' }),
    sourceInventoryHash: stableHash({ qa: 'inventory' }),
    expectedClaimsHash: stableHash(claimsBefore),
    actor: { uid: ACTOR_UID, authEmail: ACTOR_EMAIL, administrativeEmail: ACTOR_EMAIL, adminLevel: 'super_admin' },
    targetPaths,
    relatedPaths: [`approvedUsers/${UID}`, `approvedUsersByEmail/${EMAIL}`],
    artifactPaths: ['adminBackups/qa-v17-mirror-backup', 'provisioningJobs/qa-v17-mirror-job', 'auditLogs/qa-v17-mirror-audit'],
    targetActions,
    claimsAction: { path: `auth/${UID}/customClaims`, desired: {
      platformRole: 'customer', adminLevel: null, customerTier: 'founding_customer', entitlementVersion: 17, platformAdmin: false
    } },
    tenantManifest,
    backupId: 'qa-v17-mirror-backup',
    provisioningJobId: 'qa-v17-mirror-job',
    auditLogId: 'qa-v17-mirror-audit'
  };
  const evidence = {
    actor: context.actor,
    reason: 'QA mirror before production authorization',
    confirmation: 'QA_ONLY',
    reauthenticatedAt: new Date().toISOString(),
    freshAuditHash: stableHash({ qa: 'fresh-audit' })
  };

  const preview = await executeV17Provisioning({ db, auth, context, command: 'preview', evidence });
  assert.equal(preview.result, 'PREVIEW_READY');
  assert.equal(preview.productionWriteOperations, 0);
  assert.equal((await db.doc(`adminBackups/${context.backupId}`).get()).exists, false);

  const applied = await executeV17Provisioning({ db, auth, context, command: 'apply', evidence });
  assert.equal(applied.result, 'APPLIED_VERIFIED');
  assert.equal(applied.bootstrapSession.status, 'READY');
  const accountAfter = (await db.doc(`accountAccess/${UID}`).get()).data();
  assert.equal(accountAfter.planCode, 'pro_lifetime');
  assert.equal(accountAfter.lifetime, true);
  assert.equal(accountAfter.trialDays, 7, 'legacy trialDays remains preserved by merge');
  assert.equal(accountAfter.trialStartedAt.toMillis(), accountBefore.trialStartedAt.toMillis(), 'legacy trialStartedAt remains preserved by merge');
  const claimsAfter = plainFirestoreValue((await auth.getUser(UID)).customClaims || {});
  assert.equal(claimsAfter.unrelatedClaim, 'preserve-me');
  assert.equal(claimsAfter.platformAdmin, false);
  assert.equal(claimsAfter.entitlementVersion, 17);

  const secondRun = await executeV17Provisioning({ db, auth, context, command: 'apply', evidence });
  assert.equal(secondRun.result, 'NOOP_VERIFIED');
  assert.equal(secondRun.productionWriteOperations, 0);
  assert.equal((await db.collection(`organizations/${ORG_ID}/members`).get()).size, 1);

  for (const [pathValue, expectedHash] of Object.entries(tenantHashesBefore)) {
    assert.equal(firestoreHash((await db.doc(pathValue).get()).data()), expectedHash, `${pathValue} remains unchanged`);
  }

  const rollback = await rollbackV17Provisioning({ db, auth, context, reason: 'controlled emulator rollback proof' });
  assert.equal(rollback.result, 'ROLLED_BACK_VERIFIED');
  assert.equal((await db.doc(`users/${UID}`).get()).exists, false);
  assert.equal(firestoreHash((await db.doc(`accountAccess/${UID}`).get()).data()), firestoreHash(accountBefore));
  assert.deepEqual(plainFirestoreValue((await auth.getUser(UID)).customClaims || {}), claimsBefore);
  for (const [pathValue, expectedHash] of Object.entries(tenantHashesBefore)) {
    assert.equal(firestoreHash((await db.doc(pathValue).get()).data()), expectedHash, `${pathValue} remains unchanged after rollback`);
  }

  console.log('PASS V17 Shary mirror emulator: preview writes 0 documents');
  console.log('PASS V17 Shary mirror emulator: backup, apply, claims merge and bootstrap READY');
  console.log('PASS V17 Shary mirror emulator: second apply is NOOP with no duplicates');
  console.log('PASS V17 Shary mirror emulator: four tenant hashes remain unchanged');
  console.log('PASS V17 Shary mirror emulator: controlled rollback restores documents and claims');
} finally {
  await deleteApp(app);
}
