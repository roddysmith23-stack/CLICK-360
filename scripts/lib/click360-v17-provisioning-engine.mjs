import { FieldValue } from 'firebase-admin/firestore';
import { domainCounts, legacyStateFromDocument, stableHash } from './click360-data-core.mjs';
import { firestoreHash, normalizeEmail, plainFirestoreValue } from './click360-v16-admin-core.mjs';
import { bootstrapSession } from './click360-v17-access-core.mjs';
import {
  SHARY_V17_ARTIFACT_PATHS,
  SHARY_V17_AUTHORIZATION,
  SHARY_V17_RELATED_PATHS,
  SHARY_V17_TARGET_PATHS,
  documentMatchesDesired
} from './click360-v17-shary-authorization.mjs';

const INTERNAL_PRODUCTION_ROLLBACK = Symbol('click360-v17-production-rollback');

function fail(code, detail = '') {
  throw new Error(`V17_PROVISIONING_ABORTED:${code}${detail ? `:${detail}` : ''}`);
}

function materialize(value) {
  if (value === 'SERVER_TIMESTAMP') return FieldValue.serverTimestamp();
  if (Array.isArray(value)) return value.map(materialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item)]));
  }
  return value;
}

function tenantState(document = {}) {
  return document.schemaVersion === 10 ? document.payload?.data || {} : legacyStateFromDocument(document) || {};
}

function snapshotRecord(snapshot) {
  const data = snapshot.exists ? snapshot.data() || {} : null;
  return {
    path: snapshot.ref.path,
    exists: snapshot.exists,
    hash: snapshot.exists ? firestoreHash(data) : stableHash(null),
    data,
    createTime: snapshot.createTime?.toDate?.().toISOString?.() || null,
    updateTime: snapshot.updateTime?.toDate?.().toISOString?.() || null
  };
}

function authRecord(user) {
  const customClaims = plainFirestoreValue(user.customClaims || {});
  return {
    uid: user.uid,
    email: normalizeEmail(user.email),
    emailVerified: user.emailVerified === true,
    disabled: user.disabled === true,
    displayName: String(user.displayName || ''),
    photoURL: String(user.photoURL || ''),
    providers: (user.providerData || []).map((provider) => provider.providerId).sort(),
    creationTime: user.metadata?.creationTime || null,
    lastSignInTime: user.metadata?.lastSignInTime || null,
    customClaims,
    claimsHash: stableHash(customClaims)
  };
}

async function readDocumentRecords(db, paths) {
  const records = await Promise.all(paths.map(async (pathValue) => snapshotRecord(await db.doc(pathValue).get())));
  return Object.fromEntries(records.map((record) => [record.path, record]));
}

async function readTenantIntegrity(db, expectedManifest) {
  const records = [];
  for (const expected of expectedManifest) {
    const snapshot = await db.doc(expected.path).get();
    if (!snapshot.exists) fail('protected_tenant_missing', expected.path);
    const data = snapshot.data() || {};
    const hash = firestoreHash(data);
    const counts = domainCounts(tenantState(data));
    if (hash !== expected.hash) fail('protected_tenant_hash_mismatch', expected.path);
    if (stableHash(counts) !== stableHash(expected.counts)) fail('protected_tenant_counts_mismatch', expected.path);
    records.push({
      path: expected.path,
      hash,
      counts,
      classification: expected.classification || null,
      businessNames: expected.businessNames || []
    });
  }
  return records;
}

function validateContext(context) {
  if (!context?.projectId || !context?.uid || !context?.email || !context?.organizationId) fail('context_identity_missing');
  if (!Array.isArray(context.targetActions) || context.targetActions.length !== 7) fail('target_action_count');
  if (!Array.isArray(context.tenantManifest) || context.tenantManifest.length !== 4) fail('tenant_manifest_count');
  if (!context.claimsAction?.desired) fail('claims_action_missing');
  if (context.targetActions.some((action) => /^businesses\/[^/]+\/state\/main$/.test(action.path))) fail('state_main_forbidden');
  const uniquePaths = new Set(context.targetActions.map((action) => action.path));
  if (uniquePaths.size !== context.targetActions.length) fail('duplicate_target_path');
  if (context.targetActions.some((action) => !context.targetPaths.includes(action.path))) fail('target_path_not_allowlisted');
  if (context.targetPaths.some((pathValue) => !uniquePaths.has(pathValue))) fail('allowlisted_path_missing_action');

  if (context.projectId === SHARY_V17_AUTHORIZATION.projectId) {
    const authorization = SHARY_V17_AUTHORIZATION;
    if (context.subjectKey !== authorization.subjectKey) fail('production_subject_not_allowlisted');
    if (context.uid !== authorization.uid || normalizeEmail(context.email) !== authorization.email) fail('production_identity_not_allowlisted');
    if (context.organizationId !== authorization.organizationId) fail('production_organization_not_allowlisted');
    if (context.planHash !== authorization.approvedPlanHash) fail('production_plan_hash_mismatch');
    if (context.sourceAuditHash !== authorization.sourceAuditHash || context.sourceInventoryHash !== authorization.sourceInventoryHash) fail('production_source_evidence_mismatch');
    if (context.expectedClaimsHash !== authorization.expectedClaimsHash) fail('production_claims_precondition_mismatch');
    if (stableHash(context.targetPaths) !== stableHash(SHARY_V17_TARGET_PATHS)) fail('production_target_paths_mismatch');
    if (stableHash(context.relatedPaths) !== stableHash(SHARY_V17_RELATED_PATHS)) fail('production_related_paths_mismatch');
    if (stableHash(context.artifactPaths) !== stableHash(SHARY_V17_ARTIFACT_PATHS)) fail('production_artifact_paths_mismatch');
    if (stableHash(context.targetActions) !== authorization.expectedTargetActionsHash) fail('production_target_actions_mismatch');
    if (stableHash(context.claimsAction) !== authorization.expectedClaimsActionHash) fail('production_claims_action_mismatch');
    if (stableHash(context.tenantManifest) !== authorization.expectedTenantManifestHash) fail('production_tenant_manifest_mismatch');
    if (context.backupId !== authorization.backupId || context.provisioningJobId !== authorization.provisioningJobId || context.auditLogId !== authorization.auditLogId) {
      fail('production_artifact_identity_mismatch');
    }
    if (context.actor?.uid !== authorization.actor.uid
      || normalizeEmail(context.actor?.authEmail) !== authorization.actor.authEmail
      || normalizeEmail(context.actor?.administrativeEmail) !== authorization.actor.administrativeEmail
      || context.actor?.adminLevel !== 'super_admin') fail('production_actor_mismatch');
  }
}

function validateExecutionRequest(context, command, evidence = {}) {
  if (!['preview', 'apply', 'rollback'].includes(command)) fail('command_not_allowed');
  if (context.projectId !== SHARY_V17_AUTHORIZATION.projectId) return;
  const authorization = SHARY_V17_AUTHORIZATION;
  const expectedConfirmation = command === 'rollback' ? authorization.rollbackConfirmation : authorization.confirmation;
  if (evidence.confirmation !== expectedConfirmation) fail('production_confirmation_mismatch');
  if (String(evidence.reason || '').trim().length < 12) fail('production_reason_missing');
  if (evidence.actor?.uid !== authorization.actor.uid
    || normalizeEmail(evidence.actor?.authEmail) !== authorization.actor.authEmail
    || normalizeEmail(evidence.actor?.administrativeEmail) !== authorization.actor.administrativeEmail
    || evidence.actor?.adminLevel !== 'super_admin') fail('production_evidence_actor_mismatch');
  const reauthenticatedAtMs = Date.parse(String(evidence.reauthenticatedAt || ''));
  if (!Number.isFinite(reauthenticatedAtMs)
    || reauthenticatedAtMs > Date.now() + 30_000
    || Date.now() - reauthenticatedAtMs > authorization.reauthenticationMaxAgeMs) fail('production_reauthentication_invalid');
  if (!/^[a-f0-9]{64}$/.test(String(evidence.freshAuditHash || ''))) fail('production_fresh_audit_hash_invalid');
  if (normalizeEmail(evidence.adcPrincipal?.email) !== authorization.actor.administrativeEmail
    || evidence.adcPrincipal?.emailVerified !== true
    || evidence.adcPrincipal?.projectId !== authorization.projectId) fail('production_adc_principal_mismatch');
}

export function validateV17ProvisioningAuthorization({ context, command, evidence }) {
  validateContext(context);
  validateExecutionRequest(context, command, evidence);
  return { valid: true };
}

function assertAuthIdentity(record, context, expectedClaimsHash = null) {
  if (record.uid !== context.uid) fail('target_auth_uid_mismatch');
  if (record.email !== normalizeEmail(context.email)) fail('target_auth_email_mismatch');
  if (record.disabled) fail('target_auth_disabled');
  if (expectedClaimsHash && record.claimsHash !== expectedClaimsHash) fail('target_claims_hash_mismatch');
}

function assertActorIdentity(record, context) {
  if (record.uid !== context.actor.uid) fail('actor_auth_uid_mismatch');
  if (record.email !== normalizeEmail(context.actor.authEmail)) fail('actor_auth_email_mismatch');
  if (record.disabled) fail('actor_auth_disabled');
  if (context.actor.adminLevel !== 'super_admin') fail('actor_not_super_admin');
}

function assertInitialTargetState(records, context) {
  for (const action of context.targetActions) {
    const current = records[action.path];
    if (!current) fail('target_snapshot_missing', action.path);
    if (action.operation === 'CREATE_IF_ABSENT' && current.exists) fail('create_only_target_exists', action.path);
    if (action.operation === 'MERGE_WITH_HASH_PRECONDITION') {
      if (!current.exists) fail('merge_target_missing', action.path);
      if (!action.beforeHash || current.hash !== action.beforeHash) fail('merge_before_hash_mismatch', action.path);
    }
  }
}

function assertBackupMatchesCurrent(backup, targetRecords, relatedRecords, targetAuth, tenantIntegrity) {
  const payload = backup.payload;
  if (firestoreHash(payload) !== backup.payloadHash) fail('backup_payload_hash_mismatch');
  if (payload.authBefore.claimsHash !== targetAuth.claimsHash) fail('backup_auth_changed_before_apply');
  for (const before of payload.targetsBefore) {
    const current = targetRecords[before.path];
    if (!current || current.exists !== before.exists || current.hash !== before.hash) fail('target_changed_after_backup', before.path);
  }
  for (const before of payload.relatedBefore) {
    const current = relatedRecords[before.path];
    if (!current || current.exists !== before.exists || current.hash !== before.hash) fail('related_changed_after_backup', before.path);
  }
  if (stableHash(payload.tenantIntegrityBefore) !== stableHash(tenantIntegrity)) fail('tenant_changed_after_backup');
}

function buildDiff(context, targetRecords, targetAuth) {
  const rows = context.targetActions.map((action) => ({
    path: action.path,
    operation: action.operation,
    beforeExists: targetRecords[action.path].exists,
    beforeHash: targetRecords[action.path].hash,
    expectedBeforeHash: action.beforeHash || stableHash(null),
    desiredHash: stableHash(action.desired),
    changedFields: Object.keys(action.desired || {}).sort(),
    preserveUnspecifiedFields: action.operation === 'MERGE_WITH_HASH_PRECONDITION'
  }));
  const mergedClaims = { ...(targetAuth.customClaims || {}), ...context.claimsAction.desired };
  rows.push({
    path: `auth/${context.uid}/customClaims`,
    operation: 'MERGE_CUSTOM_CLAIMS',
    beforeExists: true,
    beforeHash: targetAuth.claimsHash,
    expectedBeforeHash: context.expectedClaimsHash,
    desiredHash: stableHash(mergedClaims),
    changedFields: Object.keys(context.claimsAction.desired).sort(),
    preserveUnspecifiedFields: true
  });
  rows.push(
    { path: `adminBackups/${context.backupId}`, operation: 'CREATE_IF_ABSENT', administrativeArtifact: true },
    { path: `provisioningJobs/${context.provisioningJobId}`, operation: 'CREATE_IF_ABSENT', administrativeArtifact: true },
    { path: `auditLogs/${context.auditLogId}`, operation: 'CREATE_IF_ABSENT', administrativeArtifact: true }
  );
  return rows;
}

async function captureState(db, auth, context) {
  const [targetRecords, relatedRecords, targetUser, actorUser, tenantIntegrity] = await Promise.all([
    readDocumentRecords(db, context.targetPaths),
    readDocumentRecords(db, context.relatedPaths),
    auth.getUser(context.uid),
    auth.getUser(context.actor.uid),
    readTenantIntegrity(db, context.tenantManifest)
  ]);
  return {
    targetRecords,
    relatedRecords,
    targetAuth: authRecord(targetUser),
    actorAuth: authRecord(actorUser),
    tenantIntegrity
  };
}

function backupCore(context, evidence, state) {
  return {
    formatVersion: 17,
    action: 'provision_shary_pro_lifetime',
    projectId: context.projectId,
    subject: context.subjectKey,
    uid: context.uid,
    email: normalizeEmail(context.email),
    organizationId: context.organizationId,
    planHash: context.planHash,
    sourceAuditHash: context.sourceAuditHash,
    freshAuditHash: evidence.freshAuditHash,
    sourceInventoryHash: context.sourceInventoryHash,
    actor: evidence.actor,
    reason: evidence.reason,
    confirmation: evidence.confirmation,
    reauthenticatedAt: evidence.reauthenticatedAt,
    adcPrincipal: evidence.adcPrincipal || null,
    freshAuditEvidence: evidence.freshAuditEvidence || null,
    authBefore: state.targetAuth,
    targetsBefore: context.targetPaths.map((pathValue) => state.targetRecords[pathValue]),
    relatedBefore: context.relatedPaths.map((pathValue) => state.relatedRecords[pathValue]),
    tenantIntegrityBefore: state.tenantIntegrity,
    rollbackManifest: context.targetPaths.map((pathValue) => ({
      path: pathValue,
      strategy: state.targetRecords[pathValue].exists
        ? 'RESTORE_FULL_DOCUMENT_WITH_AFTER_HASH_PRECONDITION'
        : 'DELETE_JOB_CREATED_DOCUMENT_WITH_AFTER_HASH_PRECONDITION',
      beforeHash: state.targetRecords[pathValue].hash
    }))
  };
}

async function createAndVerifyBackup(db, context, evidence, state) {
  const backupRef = db.doc(`adminBackups/${context.backupId}`);
  const payload = backupCore(context, evidence, state);
  const payloadHash = firestoreHash(payload);
  let created = false;
  try {
    await backupRef.create({
      backupId: context.backupId,
      uid: context.uid,
      planHash: context.planHash,
      payloadHash,
      payload,
      createdAt: FieldValue.serverTimestamp()
    });
    created = true;
  } catch (error) {
    if (String(error?.code) !== '6' && !String(error?.message || '').toLowerCase().includes('already exists')) throw error;
  }
  const verified = await backupRef.get();
  if (!verified.exists) fail('backup_readback_missing');
  const document = verified.data() || {};
  if (document.backupId !== context.backupId || document.uid !== context.uid || document.planHash !== context.planHash) fail('backup_identity_mismatch');
  if (document.payload?.sourceAuditHash !== context.sourceAuditHash || document.payload?.sourceInventoryHash !== context.sourceInventoryHash) fail('backup_source_evidence_mismatch');
  if (document.payload?.actor?.uid !== context.actor.uid || normalizeEmail(document.payload?.actor?.administrativeEmail) !== normalizeEmail(context.actor.administrativeEmail)) {
    fail('backup_actor_mismatch');
  }
  if (context.projectId === SHARY_V17_AUTHORIZATION.projectId
    && normalizeEmail(document.payload?.adcPrincipal?.email) !== SHARY_V17_AUTHORIZATION.actor.administrativeEmail) fail('backup_adc_principal_mismatch');
  if (firestoreHash(document.payload) !== document.payloadHash) fail('backup_readback_hash_mismatch');
  if (created && document.payloadHash !== payloadHash) fail('new_backup_payload_mismatch');
  return { ref: backupRef, document, payloadHash: document.payloadHash };
}

async function verifyAppliedState(db, auth, context, expectedAfterHashes = null, requireClaims = true) {
  const state = await captureState(db, auth, context);
  assertAuthIdentity(state.targetAuth, context);
  assertActorIdentity(state.actorAuth, context);
  for (const action of context.targetActions) {
    const current = state.targetRecords[action.path];
    if (!current.exists) fail('applied_target_missing', action.path);
    if (!documentMatchesDesired(current.data, action.desired)) fail('applied_target_mismatch', action.path);
    if (expectedAfterHashes?.[action.path] && current.hash !== expectedAfterHashes[action.path]) fail('applied_target_hash_changed', action.path);
  }
  const expectedClaims = { ...(state.targetAuth.customClaims || {}), ...context.claimsAction.desired };
  if (requireClaims && !documentMatchesDesired(state.targetAuth.customClaims, context.claimsAction.desired)) fail('applied_claims_mismatch');

  const user = state.targetRecords[`users/${context.uid}`].data;
  const entitlement = state.targetRecords[`entitlements/${context.uid}`].data;
  const organization = state.targetRecords[`organizations/${context.organizationId}`].data;
  const membership = state.targetRecords[`organizations/${context.organizationId}/members/${context.uid}`].data;
  const subscription = state.targetRecords[`subscriptions/${context.organizationId}`].data;
  const session = bootstrapSession({
    authUser: { uid: state.targetAuth.uid, email: state.targetAuth.email, disabled: state.targetAuth.disabled },
    entitlement,
    organization,
    membership,
    subscription
  });
  if (!user || user.uid !== context.uid) fail('user_identity_mismatch');
  if (session.status !== 'READY' || session.ready !== true) fail('bootstrap_not_ready', session.blockers.join(','));

  const members = await db.collection(`organizations/${context.organizationId}/members`).get();
  if (members.size !== 1 || members.docs[0]?.id !== context.uid) fail('cross_organization_membership_detected');
  return {
    state,
    session,
    claimsHash: stableHash(expectedClaims),
    afterHashes: Object.fromEntries(context.targetPaths.map((pathValue) => [pathValue, state.targetRecords[pathValue].hash]))
  };
}

async function finalizeApply(db, context, verification) {
  const jobRef = db.doc(`provisioningJobs/${context.provisioningJobId}`);
  const auditRef = db.doc(`auditLogs/${context.auditLogId}`);
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, auditSnapshot, ...targetSnapshots] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(auditRef),
      ...context.targetPaths.map((pathValue) => transaction.get(db.doc(pathValue)))
    ]);
    if (!jobSnapshot.exists || !auditSnapshot.exists) fail('finalization_artifact_missing');
    for (const snapshot of targetSnapshots) {
      const expectedHash = verification.afterHashes[snapshot.ref.path];
      if (!snapshot.exists || firestoreHash(snapshot.data() || {}) !== expectedHash) fail('target_changed_before_finalize', snapshot.ref.path);
    }
    transaction.update(jobRef, {
      status: 'COMPLETE',
      afterHashes: verification.afterHashes,
      claimsAfterHash: verification.claimsHash,
      bootstrapStatus: verification.session.status,
      completedAt: FieldValue.serverTimestamp()
    });
    transaction.update(auditRef, {
      status: 'COMPLETE',
      afterHashes: verification.afterHashes,
      claimsAfterHash: verification.claimsHash,
      bootstrapStatus: verification.session.status,
      completedAt: FieldValue.serverTimestamp()
    });
  });
}

async function applyFirestoreDocuments(db, context, backup, evidence) {
  const jobRef = db.doc(`provisioningJobs/${context.provisioningJobId}`);
  const auditRef = db.doc(`auditLogs/${context.auditLogId}`);
  await db.runTransaction(async (transaction) => {
    const refs = [backup.ref, jobRef, auditRef, ...context.targetPaths.map((pathValue) => db.doc(pathValue)), ...context.tenantManifest.map((item) => db.doc(item.path))];
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const [backupSnapshot, jobSnapshot, auditSnapshot] = snapshots;
    if (!backupSnapshot.exists || backupSnapshot.data()?.payloadHash !== backup.payloadHash) fail('transaction_backup_invalid');
    if (jobSnapshot.exists || auditSnapshot.exists) fail('idempotency_artifact_already_exists');
    const targetSnapshots = snapshots.slice(3, 3 + context.targetPaths.length);
    const tenantSnapshots = snapshots.slice(3 + context.targetPaths.length);

    for (const action of context.targetActions) {
      const snapshot = targetSnapshots.find((item) => item.ref.path === action.path);
      if (!snapshot) fail('transaction_target_missing', action.path);
      if (action.operation === 'CREATE_IF_ABSENT') {
        if (snapshot.exists) fail('transaction_create_only_exists', action.path);
      } else if (action.operation === 'MERGE_WITH_HASH_PRECONDITION') {
        if (!snapshot.exists || firestoreHash(snapshot.data() || {}) !== action.beforeHash) fail('transaction_before_hash_mismatch', action.path);
      } else {
        fail('transaction_operation_not_allowed', action.operation);
      }
    }
    for (let index = 0; index < context.tenantManifest.length; index += 1) {
      const expected = context.tenantManifest[index];
      const snapshot = tenantSnapshots[index];
      if (!snapshot.exists || snapshot.ref.path !== expected.path || firestoreHash(snapshot.data() || {}) !== expected.hash) {
        fail('transaction_tenant_integrity_mismatch', expected.path);
      }
    }

    for (const action of context.targetActions) {
      const ref = db.doc(action.path);
      if (action.operation === 'CREATE_IF_ABSENT') transaction.create(ref, materialize(action.desired));
      else transaction.set(ref, materialize(action.desired), { merge: true });
    }
    const administrativeBase = {
      projectId: context.projectId,
      subject: context.subjectKey,
      uid: context.uid,
      email: context.email,
      organizationId: context.organizationId,
      planHash: context.planHash,
      sourceAuditHash: context.sourceAuditHash,
      freshAuditHash: evidence.freshAuditHash,
      sourceInventoryHash: context.sourceInventoryHash,
      backupPath: backup.ref.path,
      actor: evidence.actor,
      reason: evidence.reason,
      confirmation: evidence.confirmation,
      reauthenticatedAt: evidence.reauthenticatedAt,
      adcPrincipal: evidence.adcPrincipal || null,
      freshAuditEvidenceHash: stableHash(evidence.freshAuditEvidence || null),
      beforeHashes: Object.fromEntries(backup.document.payload.targetsBefore.map((entry) => [entry.path, entry.hash])),
      requestedClaims: context.claimsAction.desired,
      requestedDocuments: context.targetActions.map((action) => ({ path: action.path, operation: action.operation, desiredHash: stableHash(action.desired) })),
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.create(jobRef, { ...administrativeBase, jobId: context.provisioningJobId, status: 'FIRESTORE_APPLIED_CLAIMS_PENDING' });
    transaction.create(auditRef, { ...administrativeBase, auditId: context.auditLogId, status: 'FIRESTORE_APPLIED_CLAIMS_PENDING' });
  });
}

async function resumeOrNoop(db, auth, context, jobDocument) {
  if (jobDocument.uid !== context.uid || jobDocument.planHash !== context.planHash) fail('existing_job_identity_mismatch');
  const [backupSnapshot, auditSnapshot] = await Promise.all([
    db.doc(`adminBackups/${context.backupId}`).get(),
    db.doc(`auditLogs/${context.auditLogId}`).get()
  ]);
  if (!backupSnapshot.exists) fail('existing_job_backup_missing');
  if (!auditSnapshot.exists) fail('existing_job_audit_missing');
  const backup = backupSnapshot.data() || {};
  const auditDocument = auditSnapshot.data() || {};
  if (backup.payloadHash !== firestoreHash(backup.payload)) fail('existing_job_backup_invalid');
  if (auditDocument.uid !== context.uid || auditDocument.planHash !== context.planHash) fail('existing_audit_identity_mismatch');

  if (jobDocument.status === 'COMPLETE') {
    if (auditDocument.status !== 'COMPLETE') fail('complete_job_audit_incomplete');
    if (stableHash(auditDocument.afterHashes || {}) !== stableHash(jobDocument.afterHashes || {})) fail('complete_job_audit_hash_mismatch');
    if (auditDocument.claimsAfterHash !== jobDocument.claimsAfterHash) fail('complete_job_audit_claims_mismatch');
    const verification = await verifyAppliedState(db, auth, context, jobDocument.afterHashes || null);
    if (jobDocument.claimsAfterHash !== verification.claimsHash) fail('complete_job_claims_hash_mismatch');
    return {
      result: 'NOOP_VERIFIED',
      productionWriteOperations: 0,
      backupPath: `adminBackups/${context.backupId}`,
      provisioningJobPath: `provisioningJobs/${context.provisioningJobId}`,
      auditLogPath: `auditLogs/${context.auditLogId}`,
      afterHashes: verification.afterHashes,
      claimsAfterHash: verification.claimsHash,
      bootstrapSession: verification.session,
      tenantIntegrity: verification.state.tenantIntegrity
    };
  }
  if (jobDocument.status === 'FIRESTORE_APPLIED_CLAIMS_PENDING') {
    if (auditDocument.status !== 'FIRESTORE_APPLIED_CLAIMS_PENDING') fail('pending_job_audit_status_mismatch');
    const beforeVerification = await verifyAppliedState(db, auth, context, null, false);
    const user = await auth.getUser(context.uid);
    const currentClaims = plainFirestoreValue(user.customClaims || {});
    await auth.setCustomUserClaims(context.uid, { ...currentClaims, ...context.claimsAction.desired });
    const verification = await verifyAppliedState(db, auth, context, beforeVerification.afterHashes);
    await finalizeApply(db, context, verification);
    return {
      result: 'APPLIED_VERIFIED_RESUMED',
      productionWriteOperations: 3,
      backupPath: `adminBackups/${context.backupId}`,
      provisioningJobPath: `provisioningJobs/${context.provisioningJobId}`,
      auditLogPath: `auditLogs/${context.auditLogId}`,
      afterHashes: verification.afterHashes,
      claimsAfterHash: verification.claimsHash,
      bootstrapSession: verification.session,
      tenantIntegrity: verification.state.tenantIntegrity
    };
  }
  fail('existing_job_requires_manual_review', jobDocument.status || 'missing_status');
}

export async function rollbackV17Provisioning({ db, auth, context, reason = 'automatic rollback', productionAuthorization = null }) {
  validateContext(context);
  if (context.projectId === SHARY_V17_AUTHORIZATION.projectId && productionAuthorization !== INTERNAL_PRODUCTION_ROLLBACK) {
    fail('production_rollback_must_use_authorized_executor');
  }
  const backupRef = db.doc(`adminBackups/${context.backupId}`);
  const jobRef = db.doc(`provisioningJobs/${context.provisioningJobId}`);
  const auditRef = db.doc(`auditLogs/${context.auditLogId}`);
  const [backupSnapshot, jobSnapshot, auditSnapshot] = await Promise.all([backupRef.get(), jobRef.get(), auditRef.get()]);
  if (!backupSnapshot.exists || !jobSnapshot.exists || !auditSnapshot.exists) fail('rollback_artifact_missing');
  const backup = backupSnapshot.data() || {};
  if (backup.payloadHash !== firestoreHash(backup.payload)) fail('rollback_backup_invalid');
  const beforeByPath = Object.fromEntries(backup.payload.targetsBefore.map((entry) => [entry.path, entry]));

  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(context.targetPaths.map((pathValue) => transaction.get(db.doc(pathValue))));
    for (const action of context.targetActions) {
      const snapshot = snapshots.find((item) => item.ref.path === action.path);
      if (!snapshot?.exists || !documentMatchesDesired(snapshot.data() || {}, action.desired)) fail('rollback_target_not_owned_by_job', action.path);
    }
    for (const action of context.targetActions) {
      const ref = db.doc(action.path);
      const before = beforeByPath[action.path];
      if (before.exists) transaction.set(ref, before.data);
      else transaction.delete(ref);
    }
    transaction.update(jobRef, { status: 'ROLLBACK_CLAIMS_PENDING', rollbackReason: reason, rollbackStartedAt: FieldValue.serverTimestamp() });
    transaction.update(auditRef, { status: 'ROLLBACK_CLAIMS_PENDING', rollbackReason: reason, rollbackStartedAt: FieldValue.serverTimestamp() });
  });

  const currentUser = await auth.getUser(context.uid);
  const currentClaims = plainFirestoreValue(currentUser.customClaims || {});
  const expectedAppliedClaims = { ...backup.payload.authBefore.customClaims, ...context.claimsAction.desired };
  if (stableHash(currentClaims) !== stableHash(expectedAppliedClaims) && stableHash(currentClaims) !== backup.payload.authBefore.claimsHash) {
    fail('rollback_claims_changed_outside_job');
  }
  await auth.setCustomUserClaims(context.uid, backup.payload.authBefore.customClaims || {});
  await Promise.all([
    jobRef.update({ status: 'ROLLED_BACK', rolledBackAt: FieldValue.serverTimestamp() }),
    auditRef.update({ status: 'ROLLED_BACK', rolledBackAt: FieldValue.serverTimestamp() })
  ]);

  const restored = await captureState(db, auth, context);
  for (const before of backup.payload.targetsBefore) {
    const current = restored.targetRecords[before.path];
    if (current.exists !== before.exists || current.hash !== before.hash) fail('rollback_verification_failed', before.path);
  }
  if (restored.targetAuth.claimsHash !== backup.payload.authBefore.claimsHash) fail('rollback_claims_verification_failed');
  return {
    result: 'ROLLED_BACK_VERIFIED',
    productionWriteOperations: context.targetPaths.length + 5,
    backupPath: backupRef.path,
    provisioningJobPath: jobRef.path,
    auditLogPath: auditRef.path,
    tenantIntegrity: restored.tenantIntegrity
  };
}

export async function executeV17Provisioning({ db, auth, context, command, evidence }) {
  validateV17ProvisioningAuthorization({ context, command, evidence });
  const jobRef = db.doc(`provisioningJobs/${context.provisioningJobId}`);
  const jobSnapshot = await jobRef.get();
  if (command === 'rollback') return rollbackV17Provisioning({
    db, auth, context, reason: evidence.reason, productionAuthorization: INTERNAL_PRODUCTION_ROLLBACK
  });
  if (jobSnapshot.exists) return resumeOrNoop(db, auth, context, jobSnapshot.data() || {});

  const state = await captureState(db, auth, context);
  assertAuthIdentity(state.targetAuth, context, context.expectedClaimsHash);
  assertActorIdentity(state.actorAuth, context);
  assertInitialTargetState(state.targetRecords, context);
  const diff = buildDiff(context, state.targetRecords, state.targetAuth);
  if (command === 'preview') {
    return {
      result: 'PREVIEW_READY',
      productionWriteOperations: 0,
      diff,
      tenantIntegrity: state.tenantIntegrity,
      targetAuth: state.targetAuth,
      actorAuth: state.actorAuth,
      artifactPaths: {
        backup: `adminBackups/${context.backupId}`,
        provisioningJob: `provisioningJobs/${context.provisioningJobId}`,
        auditLog: `auditLogs/${context.auditLogId}`
      }
    };
  }

  const backup = await createAndVerifyBackup(db, context, evidence, state);
  const stateAfterBackup = await captureState(db, auth, context);
  assertBackupMatchesCurrent(backup.document, stateAfterBackup.targetRecords, stateAfterBackup.relatedRecords, stateAfterBackup.targetAuth, stateAfterBackup.tenantIntegrity);
  try {
    await applyFirestoreDocuments(db, context, backup, evidence);
    const userBeforeClaims = authRecord(await auth.getUser(context.uid));
    if (userBeforeClaims.claimsHash !== context.expectedClaimsHash) fail('claims_changed_before_refresh');
    await auth.setCustomUserClaims(context.uid, { ...userBeforeClaims.customClaims, ...context.claimsAction.desired });
    const verification = await verifyAppliedState(db, auth, context);
    await finalizeApply(db, context, verification);
    return {
      result: 'APPLIED_VERIFIED',
      productionWriteOperations: context.targetPaths.length + 6,
      backupPath: backup.ref.path,
      backupPayloadHash: backup.payloadHash,
      provisioningJobPath: `provisioningJobs/${context.provisioningJobId}`,
      auditLogPath: `auditLogs/${context.auditLogId}`,
      diff,
      afterHashes: verification.afterHashes,
      claimsBeforeHash: context.expectedClaimsHash,
      claimsAfterHash: verification.claimsHash,
      bootstrapSession: verification.session,
      tenantIntegrity: verification.state.tenantIntegrity
    };
  } catch (error) {
    const pendingJob = await jobRef.get();
    if (pendingJob.exists) {
      try {
        await rollbackV17Provisioning({
          db,
          auth,
          context,
          reason: `automatic:${String(error?.message || error)}`,
          productionAuthorization: INTERNAL_PRODUCTION_ROLLBACK
        });
      } catch (rollbackError) {
        throw new Error(`${String(error?.message || error)}; ROLLBACK_FAILED:${String(rollbackError?.message || rollbackError)}`);
      }
    }
    throw error;
  }
}
