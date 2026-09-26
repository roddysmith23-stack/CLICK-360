#!/usr/bin/env node

import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { connectAdmin } from '../lib/firebase-admin-connect.mjs';
import {
  AUTHORIZED_SESSION_HASHES,
  BUSINESS_DATE,
  EXPECTED_BUSINESS_ID_SHA256,
  EXPECTED_OWNER_ID_SHA256,
  EXPECTED_SOURCE_PATH_SHA256,
  INCIDENT_ID,
  PROJECT_ID,
  assessRepairState,
  buildPatchedSessions,
  canonicalJson,
  collectionHashes,
  sha256,
  typeAwareDiff
} from './shary-cash-repair-core.mjs';

function parseArgs(argv) {
  return Object.fromEntries(argv.map((entry) => {
    const [key, ...rest] = entry.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
  }));
}

function businessDate(timeZone = 'America/Guayaquil') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
}

const args = parseArgs(process.argv.slice(2));
const apply = args.apply === true;
const dryRun = args['dry-run'] === true;
if (apply === dryRun) throw new Error('Choose exactly one mode: --dry-run or --apply.');
if (String(args.project || '') !== PROJECT_ID) throw new Error(`Refusing project ${String(args.project || '')}. Only ${PROJECT_ID} is allowed.`);
if (!args['backup-dir'] || !args.out) throw new Error('Required: --backup-dir=<verified private backup> --out=<private result file>.');

const backupDirectory = path.resolve(String(args['backup-dir']));
const backupPath = path.join(backupDirectory, 'firestore-native-backup.private.json');
const manifestPath = path.join(backupDirectory, 'manifest.private.json');
const outputPath = path.resolve(String(args.out));
const backupBytes = await readFile(backupPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const backup = JSON.parse(backupBytes);

if (sha256(backupBytes) !== manifest.backupSha256) throw new Error('Verified backup hash mismatch.');
if (manifest.projectId !== PROJECT_ID || manifest.acquisitionMode !== 'server-read-only') throw new Error('Backup project or acquisition mode mismatch.');
if (sha256(manifest.sourcePath) !== EXPECTED_SOURCE_PATH_SHA256 || manifest.sourcePathSha256 !== EXPECTED_SOURCE_PATH_SHA256) throw new Error('Tenant source path does not match the pinned SHARY identity.');
if (sha256(String(backup.tenant?.ownerId || '')) !== EXPECTED_OWNER_ID_SHA256) throw new Error('Owner identity does not match the pinned SHARY identity.');
const businessId = backup.tenant?.matchedBusinessIds?.[0] || '';
if (sha256(String(businessId)) !== EXPECTED_BUSINESS_ID_SHA256) throw new Error('Business identity does not match the pinned SHARY identity.');

if (apply) {
  if (args.confirm !== 'APPLY_SHARY_P0_2026_09_25') throw new Error('--apply requires --confirm=APPLY_SHARY_P0_2026_09_25.');
  if (!String(args.actor || '').trim()) throw new Error('--apply requires --actor=<authorized operator>.');
  if (Number(args['expected-revision']) !== Number(manifest.sourceRevision)) throw new Error('--expected-revision must match the fresh verified manifest.');
  if (String(args['expected-fields-sha256'] || '') !== manifest.documentHashes.stateMainFieldsSha256) throw new Error('--expected-fields-sha256 must match the fresh verified manifest.');
}

const db = await connectAdmin(PROJECT_ID, `shary-cash-repair-${apply ? 'apply' : 'dry-run'}`);
const stateRef = db.doc(manifest.sourcePath);
const initialSnapshot = await stateRef.get();
if (!initialSnapshot.exists || !initialSnapshot._fieldsProto) throw new Error('Pinned SHARY state/main is unavailable.');
const initialDocument = initialSnapshot.data();
const initialFieldsSha256 = sha256(canonicalJson(initialSnapshot._fieldsProto));
const initialRevision = Number(initialDocument.revision ?? initialDocument.payload?.revision ?? 0);
if (initialRevision !== Number(manifest.sourceRevision) || initialFieldsSha256 !== manifest.documentHashes.stateMainFieldsSha256) {
  throw new Error('Remote state changed after the verified backup. Generate a new backup and preview; repair aborted.');
}

const initialState = initialDocument.payload?.data || {};
const initialAssessment = assessRepairState(initialState, businessId, businessDate());
if (!initialAssessment.authorized) throw new Error('Live state no longer matches the two authorized orphan sessions or the unique $48 transaction invariant. Re-investigate; repair aborted.');
const candidateIds = initialAssessment.candidates.map((candidate) => candidate.id);

const publicResult = {
  incident: INCIDENT_ID,
  mode: apply ? 'APPLY' : 'DRY_RUN',
  projectId: PROJECT_ID,
  tenantIdentity: {
    sourcePathSha256: EXPECTED_SOURCE_PATH_SHA256,
    ownerIdSha256: EXPECTED_OWNER_ID_SHA256,
    businessIdSha256: EXPECTED_BUSINESS_ID_SHA256
  },
  backup: { sha256:manifest.backupSha256, revision:manifest.sourceRevision, fieldsSha256:manifest.documentHashes.stateMainFieldsSha256, verified:true },
  liveComparison: { revision:initialRevision, fieldsSha256:initialFieldsSha256, unchanged:true },
  repair: {
    businessDate: BUSINESS_DATE,
    sessionIdSha256: initialAssessment.candidates.map((candidate) => candidate.idSha256).sort(),
    candidates: initialAssessment.candidates.map(({ idSha256, date, linkedSales, linkedMovements, movementKinds, linkedReports, safe }) => ({ idSha256, date, linkedSales, linkedMovements, movementKinds, linkedReports, safe })),
    staleUnresolvedCount: initialAssessment.staleUnresolvedCount,
    otherCurrentOrFutureOpenSessions: initialAssessment.currentOrFutureUnresolvedCount,
    fortyEightSale: initialAssessment.fortyEightSale,
    mutationScope: [
      'payload.data.cashSessions[authorized-session-1]',
      'payload.data.cashSessions[authorized-session-2]',
      'revision', 'baseRevision', 'updatedAt', 'updatedAtMs', 'reason',
      'adminAuditLogs/<deterministic-operation-id>'
    ],
    preservedCollectionHashes: initialAssessment.collectionHashes
  },
  firestoreWrites: 0
};

if (!apply) {
  await writeFile(outputPath, `${JSON.stringify(publicResult, null, 2)}\n`, { mode:0o600 });
  await chmod(outputPath, 0o600);
  console.log(JSON.stringify({ ...publicResult, outputPath }, null, 2));
  process.exit(0);
}

const operationId = `${INCIDENT_ID}-${initialRevision + 1}`;
const auditRef = db.collection('adminAuditLogs').doc(operationId);
const operationTimestamp = Timestamp.now();
const timestampIso = operationTimestamp.toDate().toISOString();
let beforeTransactionDocument = null;

await db.runTransaction(async (transaction) => {
  const [currentSnapshot, existingAudit] = await Promise.all([transaction.get(stateRef), transaction.get(auditRef)]);
  if (existingAudit.exists) throw new Error('Audit operation already exists; refusing a duplicate repair.');
  if (!currentSnapshot.exists || !currentSnapshot._fieldsProto) throw new Error('Pinned state/main disappeared during transaction.');
  const currentFieldsSha256 = sha256(canonicalJson(currentSnapshot._fieldsProto));
  const currentDocument = currentSnapshot.data();
  const currentRevision = Number(currentDocument.revision ?? currentDocument.payload?.revision ?? 0);
  if (currentRevision !== initialRevision || currentFieldsSha256 !== initialFieldsSha256) throw new Error('Concurrent remote change detected; transaction aborted.');
  const currentState = currentDocument.payload?.data || {};
  const assessment = assessRepairState(currentState, businessId, businessDate());
  if (!assessment.authorized || JSON.stringify(assessment.staleHashes) !== JSON.stringify(AUTHORIZED_SESSION_HASHES)) throw new Error('Authorized session set changed during transaction; transaction aborted.');
  beforeTransactionDocument = currentDocument;
  const nextSessions = buildPatchedSessions(currentState.cashSessions || [], candidateIds, timestampIso);
  const nextRevision = currentRevision + 1;

  transaction.update(stateRef, {
    'payload.data.cashSessions': nextSessions,
    revision: nextRevision,
    baseRevision: currentRevision,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: operationTimestamp.toMillis(),
    reason: 'shary_cash_session_reconciliation'
  });
  transaction.create(auditRef, {
    auditId: operationId,
    projectId: PROJECT_ID,
    action: 'shary_cash_session_reconciliation',
    incident: INCIDENT_ID,
    targetPath: stateRef.path,
    uid: backup.tenant.ownerId,
    businessId,
    actor: String(args.actor).trim(),
    beforeRevision: currentRevision,
    afterRevision: nextRevision,
    beforeFieldsSha256: currentFieldsSha256,
    backupSha256: manifest.backupSha256,
    sessionIdSha256: AUTHORIZED_SESSION_HASHES,
    fieldsChanged: ['payload.data.cashSessions', 'revision', 'baseRevision', 'updatedAt', 'updatedAtMs', 'reason'],
    createdAt: FieldValue.serverTimestamp()
  });
});

const [afterSnapshot, auditSnapshot] = await Promise.all([stateRef.get(), auditRef.get()]);
if (!afterSnapshot.exists || !auditSnapshot.exists) throw new Error('Independent post-check could not read the repaired state and audit record.');
const afterDocument = afterSnapshot.data();
const afterState = afterDocument.payload?.data || {};
const afterAssessment = assessRepairState(afterState, businessId, businessDate());
if (afterAssessment.staleUnresolvedCount !== 0) throw new Error('Post-check failed: stale open sessions remain.');
if (JSON.stringify(collectionHashes(afterState)) !== JSON.stringify(initialAssessment.collectionHashes)) throw new Error('Post-check failed: a protected business collection changed.');
if (!afterAssessment.fortyEightSale.referencesAreReportsNotTransactions || afterAssessment.fortyEightSale.transactionCount !== 1) throw new Error('Post-check failed: the $48 transaction invariant changed.');
if (Number(afterDocument.revision) !== initialRevision + 1) throw new Error('Post-check failed: revision did not increment exactly once.');

const diffPaths = typeAwareDiff(beforeTransactionDocument, afterDocument);
const candidateIndexes = candidateIds.map((id) => (beforeTransactionDocument.payload?.data?.cashSessions || []).findIndex((session) => session.id === id));
const expectedDiffs = new Set([
  'root.revision', 'root.baseRevision', 'root.updatedAt', 'root.updatedAtMs', 'root.reason',
  ...candidateIndexes.flatMap((index) => ['status', 'closedAt', 'reconciledAt', 'reconciliationReason', 'reconciliationIncident']
    .map((field) => `root.payload.data.cashSessions.${index}.${field}`))
]);
const unexpectedDiffs = diffPaths.filter((item) => !expectedDiffs.has(item));
if (unexpectedDiffs.length) throw new Error(`Post-check failed: unexpected state fields changed: ${JSON.stringify(unexpectedDiffs)}.`);

const appliedResult = {
  ...publicResult,
  firestoreWrites: 2,
  result: 'APPLIED_VERIFIED',
  auditPathSha256: sha256(auditRef.path),
  afterRevision: Number(afterDocument.revision),
  afterFieldsSha256: sha256(canonicalJson(afterSnapshot._fieldsProto)),
  structuralDiffPaths: diffPaths
};
await writeFile(outputPath, `${JSON.stringify(appliedResult, null, 2)}\n`, { mode:0o600 });
await chmod(outputPath, 0o600);
console.log(JSON.stringify({ ...appliedResult, outputPath }, null, 2));
