/** Pure recovery state machine. The transport is injected; no implicit network. */
import { createHash } from 'node:crypto';
import { validateRecoveredData } from './validate-candidate.mjs';
export const MARKER = 'SHARY_DATA_RECOVERY_2026_08_31';
export const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Firestore omits empty repeated fields in REST responses. {} and {values:[]}
// encode the same typed empty array, not an absent business field. Normalize
// only protocol values, never arbitrary customer maps or null-vs-absent data.
export function firestoreFieldsHash(fields) {
  const normalize = value => {
    if (value.arrayValue) return {arrayValue:{values:(value.arrayValue.values || []).map(normalize)}};
    if (value.mapValue) return {mapValue:{fields:map(value.mapValue.fields || {})}};
    if (typeof value.timestampValue === 'string') {
      const match=value.timestampValue.match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/);
      if(match)return {timestampValue:match[1]+'.'+(match[2]||'').padEnd(9,'0')+'Z'};
    }
    return value;
  };
  const map = object => Object.fromEntries(Object.entries(object).map(([key,value])=>[key,normalize(value)]));
  return hash(map(fields));
}
export const assert = (ok, message) => { if (!ok) throw new Error(message); };
export function decode(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) { const n = Number(value.integerValue); assert(Number.isSafeInteger(n), 'UNSAFE_INTEGER'); return n; }
  if ('doubleValue' in value) { const n = Number(value.doubleValue); assert(Number.isFinite(n), 'NONFINITE_NUMBER'); return n; }
  if ('timestampValue' in value) return { firestoreTimestamp: value.timestampValue };
  if ('bytesValue' in value) return { firestoreBytes: value.bytesValue };
  if ('referenceValue' in value) return { firestoreReference: value.referenceValue };
  if ('geoPointValue' in value) return { firestoreGeoPoint: value.geoPointValue };
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k,decode(v)]));
  throw new Error('UNKNOWN_FIRESTORE_VALUE');
}
export const fieldsData = fields => decode({mapValue:{fields}});
const text = value => ({stringValue:String(value)});
const integer = value => ({integerValue:String(value)});

export function assertScope(scope, document) {
  assert(scope.projectId === 'click-360' || scope.projectId === 'demo-click360-recovery', 'PROJECT_SCOPE_DENIED');
  // Pin the authorized production tenant without putting its raw identifier in
  // source. This digest is the independently proven C9 scope, not a CLI flag.
  if (scope.projectId === 'click-360') assert(hash(scope) === '53c8df5cdf4725d7fc2919faaf4a99354b9879a32fcbc8d1ebf15d09c548bf29', 'PRODUCTION_TENANT_NOT_SHARY');
  assert(scope.databaseId === '(default)', 'DATABASE_SCOPE_DENIED');
  assert(/^[A-Za-z0-9_-]{1,128}$/.test(scope.ownerUid || ''), 'INVALID_OWNER_PATH');
  assert(scope.ownerUid && scope.businessId === scope.ownerUid, 'OWNER_BUSINESS_SCOPE_DENIED');
  assert(scope.tenantKey === `owner:${scope.ownerUid}:business:${scope.businessId}`, 'TENANT_SCOPE_DENIED');
  assert(scope.documentPath === `businesses/${scope.businessId}/state/main`, 'DOCUMENT_SCOPE_DENIED');
  const expected = `projects/${scope.projectId}/databases/(default)/documents/${scope.documentPath}`;
  assert(document.name === expected, 'DOCUMENT_NAME_MISMATCH');
  const data = fieldsData(document.fields);
  for (const identity of [data, data.payload?.identity]) {
    assert(identity?.ownerUid === scope.ownerUid && identity?.ownerId === scope.ownerUid
      && identity?.businessId === scope.businessId && identity?.tenantKey === scope.tenantKey, 'DOCUMENT_IDENTITY_MISMATCH');
  }
  assert(data.schemaVersion === 10 && data.payload?.schemaVersion === 10, 'SCHEMA_MISMATCH');
  return data;
}

export function assertReady(candidate, attestation) {
  const document = candidate.proposedHistoricalDocument;
  assertScope(candidate.scope, document);
  assert(candidate.restoreEligible === true, 'CANDIDATE_NOT_RESTORE_ELIGIBLE');
  const integrity=validateRecoveredData(fieldsData(document.fields).payload.data,{production:candidate.scope.projectId==='click-360'});
  assert(integrity.valid,'CANDIDATE_INTEGRITY_'+integrity.errors.join('_'));
  assert(attestation.marker === MARKER && attestation.candidateHash === hash(candidate), 'ATTESTATION_HASH_MISMATCH');
  for (const gate of ['identity', 'schema', 'intrinsicIntegrity', 'noSyntheticData', 'deltasExplained',
    'newerWritesPreserved', 'liveWritersControlled', 'rollbackTested']) {
    assert(attestation.gates?.[gate] === 'PASS', 'GATE_NOT_PASS_' + gate);
  }
  assert(Array.isArray(attestation.evidence) && attestation.evidence.length > 0
    && attestation.evidence.every(e => /^[a-f0-9]{64}$/.test(e.sha256) && typeof e.path === 'string'), 'EVIDENCE_REQUIRED');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(attestation.expectedUpdateTime || '')
    && Number.isSafeInteger(attestation.expectedRevision) && attestation.expectedRevision >= 0, 'EXPECTED_PREIMAGE_REQUIRED');
  assert(/^SHARY_DATA_RECOVERY_2026_08_31_[A-Za-z0-9_-]+$/.test(attestation.operationId), 'INVALID_OPERATION_ID');
  return document;
}

export function assertCurrent(candidate, attestation, current) {
  const data = assertScope(candidate.scope, current);
  assert(current.updateTime === attestation.expectedUpdateTime && data.revision === attestation.expectedRevision, 'CONCURRENT_WRITE_RECONCILE_REQUIRED');
}

export function buildReplacement(candidate, current, operationId, now = Date.now()) {
  assert(Number.isSafeInteger(now) && now >= 0, 'INVALID_OPERATION_TIME');
  const data = assertScope(candidate.scope, current);
  assert(Number.isSafeInteger(data.revision) && data.revision >= 0, 'INVALID_CURRENT_REVISION');
  const revision = Math.max(now, Number(data.revision) + 1);
  assert(Number.isSafeInteger(revision), 'REVISION_OVERFLOW');
  const fields = structuredClone(candidate.proposedHistoricalDocument.fields);
  // Historical metadata is never used as the new revision. Preserve *current*
  // unrelated envelope fields; only recovered payload + sync metadata change.
  const merged = {...current.fields, payload:fields.payload, schemaVersion:fields.schemaVersion,
    revision:integer(revision), baseRevision:integer(data.revision), updatedAtMs:integer(now),
    updatedAt:text(new Date(now).toISOString()), reason:text('controlled_data_recovery'),
    recoveryMarker:text(MARKER), recoveryOperationId:text(operationId)};
  return {name:current.name, fields:merged};
}

export async function applyRecovery({client,candidate,attestation,backup,now}) {
  assertReady(candidate,attestation);
  assertScope(candidate.scope, backup.before);
  assert(backup.candidateHash === hash(candidate) && backup.beforeHash === firestoreFieldsHash(backup.before.fields), 'BACKUP_HASH_MISMATCH');
  assert(backup.managedBackupVerified === true, 'MANAGED_BACKUP_NOT_VERIFIED');
  assert(backup.before.updateTime === attestation.expectedUpdateTime, 'BACKUP_PRECONDITION_MISMATCH');
  const current = await client.get(candidate.proposedHistoricalDocument.name);
  const currentData = assertScope(candidate.scope, current);
  if (currentData.recoveryOperationId === attestation.operationId) {
    assert(firestoreFieldsHash(current.fields) === backup.expectedAfterHash, 'IDEMPOTENT_RESULT_DIVERGED');
    const second = await client.get(current.name);
    assertScope(candidate.scope, second);
    assert(second.updateTime === current.updateTime && firestoreFieldsHash(second.fields) === backup.expectedAfterHash, 'IDEMPOTENT_RESULT_DIVERGED');
    return {status:'ALREADY_APPLIED', current,second};
  }
  assertCurrent(candidate,attestation,current);
  assert(firestoreFieldsHash(current.fields) === backup.beforeHash, 'CURRENT_BACKUP_MISMATCH');
  const replacement = buildReplacement(candidate,current,attestation.operationId,now);
  assert(firestoreFieldsHash(replacement.fields) === backup.expectedAfterHash, 'EXPECTED_AFTER_HASH_MISMATCH');
  await client.commit([
    {update:replacement,currentDocument:{updateTime:current.updateTime}},
    {update:{name:current.name.replace(/\/businesses\/.*$/, `/adminAuditLogs/${attestation.operationId}`),fields:{
      action:text('shary_data_recovery'),operationId:text(attestation.operationId),marker:text(MARKER),
      targetPath:text(candidate.scope.documentPath),ownerUid:text(candidate.scope.ownerUid),
      beforeHash:text(backup.beforeHash),afterHash:text(backup.expectedAfterHash),createdAt:text(new Date(now).toISOString())}},currentDocument:{exists:false}}
  ]);
  const first = await client.get(current.name);
  const second = await client.get(current.name);
  assertScope(candidate.scope, first);
  assertScope(candidate.scope, second);
  if (firestoreFieldsHash(first.fields) !== backup.expectedAfterHash || firestoreFieldsHash(second.fields) !== backup.expectedAfterHash
    || first.updateTime !== second.updateTime) {
    return {status:'VERIFY_FAILED_REQUIRES_CONDITIONAL_ROLLBACK',first,second};
  }
  return {status:'SHARY_DATA_RECOVERY_VERIFIED',first,second};
}

export async function conditionalRollback({client,candidate,backup,expectedPostUpdateTime,now=Date.now()}) {
  assertScope(candidate.scope,backup.before);
  assert(backup.candidateHash === hash(candidate), 'BACKUP_CANDIDATE_MISMATCH');
  assert(Number.isSafeInteger(now) && now >= 0, 'INVALID_OPERATION_TIME');
  const current = await client.get(candidate.proposedHistoricalDocument.name);
  assertScope(candidate.scope,current);
  assert(firestoreFieldsHash(backup.before.fields) === backup.beforeHash, 'BACKUP_HASH_MISMATCH');
  assert(current.updateTime === expectedPostUpdateTime && firestoreFieldsHash(current.fields) === backup.expectedAfterHash, 'ROLLBACK_BLOCKED_BY_EXTERNAL_WRITE');
  const data = fieldsData(current.fields);
  assert(data.recoveryMarker === MARKER && /^SHARY_DATA_RECOVERY_2026_08_31_[A-Za-z0-9_-]+$/.test(data.recoveryOperationId || ''), 'ROLLBACK_NOT_A_RECOVERY_WRITE');
  const revision = Math.max(now, Number(data.revision)+1);
  assert(Number.isSafeInteger(revision), 'REVISION_OVERFLOW');
  const fields = {...structuredClone(backup.before.fields), revision:integer(revision),baseRevision:integer(data.revision),
    updatedAtMs:integer(now),updatedAt:text(new Date(now).toISOString()),reason:text('controlled_recovery_rollback'),recoveryMarker:text(MARKER)};
  const rollbackAuditName = current.name.replace(/\/businesses\/.*$/, `/adminAuditLogs/${data.recoveryOperationId}_rollback`);
  await client.commit([
    {update:{name:current.name,fields},currentDocument:{updateTime:expectedPostUpdateTime}},
    {update:{name:rollbackAuditName,fields:{action:text('shary_data_recovery_rollback'),marker:text(MARKER),
      operationId:text(data.recoveryOperationId),targetPath:text(candidate.scope.documentPath),
      beforeHash:text(backup.expectedAfterHash),afterHash:text(firestoreFieldsHash(fields)),createdAt:text(new Date(now).toISOString())}},currentDocument:{exists:false}}
  ]);
  const actual = await client.get(current.name);
  assertScope(candidate.scope,actual);
  assert(firestoreFieldsHash(actual.fields) === firestoreFieldsHash(fields), 'ROLLBACK_VERIFY_FAILED');
  const second = await client.get(current.name);
  assertScope(candidate.scope,second);
  assert(second.updateTime === actual.updateTime && firestoreFieldsHash(second.fields) === firestoreFieldsHash(fields), 'ROLLBACK_VERIFY_FAILED');
  return {status:'RECOVERY_ROLLED_BACK',actual,second};
}
