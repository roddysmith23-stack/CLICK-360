import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

await import('../worker-data-boundary.js');
const boundary = globalThis.CLICK360_WORKER_DATA_BOUNDARY;
const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(boundary.canonicalJson(value)).digest('hex');
}

function extractLegacyState(document) {
  if (document?.payload?.data) return document.payload.data;
  if (document?.state) return document.state;
  return document;
}

function assertIdentity(value, expected, label) {
  for (const key of ['ownerUid', 'businessId', 'tenantKey', 'boundarySchemaVersion']) {
    if (value?.[key] !== expected[key]) throw new Error(`${label} identity mismatch: ${key}`);
  }
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
}

async function connectAdmin(projectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore')
  ]);
  const app = getApps().find((candidate) => candidate.options.projectId === projectId)
    || initializeApp({ credential:applicationDefault(), projectId }, `worker-boundary-${projectId}`);
  return getFirestore(app);
}

async function sourceFromFirestore(db, ownerUid) {
  const ref = db.collection('businesses').doc(ownerUid).collection('state').doc('main');
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`Missing source: ${ref.path}`);
  return { ref, raw:snapshot.data(), state:extractLegacyState(snapshot.data()), updateTime:snapshot.updateTime?.toDate?.().toISOString?.() || '' };
}

function writeEntries(plan) {
  return boundary.MODULES.flatMap((moduleName) => (plan.collections[moduleName] || []).map((record) => ({ moduleName, id:record.id, record })));
}

async function verifyExistingRecords(rootRef, plan) {
  const missing = [];
  const mismatches = [];
  for (const entry of writeEntries(plan)) {
    const ref = rootRef.collection(entry.moduleName).doc(entry.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      missing.push({ ...entry, ref });
    } else if (boundary.canonicalJson(snapshot.data()) !== boundary.canonicalJson(entry.record)) {
      mismatches.push(`${entry.moduleName}/${entry.id}`);
    }
  }
  return { missing, mismatches };
}

async function applyPlan({ db, plan, source, sourceHash, expectedSourceHash }) {
  if (sourceHash !== expectedSourceHash) throw new Error('The approved source hash does not match the current state/main snapshot.');
  const { ownerUid, businessId } = plan.manifest;
  const expectedIdentity = boundary.identity(ownerUid, businessId);
  const rootRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
  const backupId = `worker-boundary-${ownerUid}-${businessId}-${sourceHash.slice(0, 12)}`;
  const backupRef = db.collection('adminBackups').doc(backupId);
  const backupPayload = {
    id:backupId,
    kind:'worker_data_boundary_source_reference',
    environment:'staging',
    projectId:STAGING_PROJECT,
    ownerUid,
    businessId,
    sourcePath:source.ref.path,
    sourceHash,
    sourceUpdateTime:source.updateTime,
    sourcePreservedInPlace:true,
    rollback:{ sourcePath:source.ref.path, action:'set_business_unit_status_ROLLBACK_ONLY', deletesRequired:false },
    counts:plan.manifest.counts,
    totals:plan.manifest.totals,
    generatedAt:plan.manifest.generatedAt
  };

  const backupSnapshot = await backupRef.get();
  if (!backupSnapshot.exists) await backupRef.create(backupPayload);
  else if (boundary.canonicalJson(backupSnapshot.data()) !== boundary.canonicalJson(backupPayload)) throw new Error('Existing backup manifest does not match; aborting.');
  const verifiedBackup = await backupRef.get();
  if (!verifiedBackup.exists || verifiedBackup.data().sourceHash !== sourceHash) throw new Error('Backup verification failed before migration.');

  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) {
    await rootRef.create({ ...plan.manifest, migrationVersion:'worker-boundary-v1', backupPath:backupRef.path });
  } else {
    const root = rootSnapshot.data();
    assertIdentity(root, expectedIdentity, 'businessUnit');
    if (root.sourceHash !== sourceHash || !['PREPARED', 'VERIFIED'].includes(root.status)) throw new Error('Existing businessUnit is not resumable.');
  }

  const preflight = await verifyExistingRecords(rootRef, plan);
  if (preflight.mismatches.length) throw new Error(`Create-only collision: ${preflight.mismatches.join(', ')}`);
  for (let offset = 0; offset < preflight.missing.length; offset += 400) {
    const batch = db.batch();
    preflight.missing.slice(offset, offset + 400).forEach((entry) => batch.create(entry.ref, entry.record));
    await batch.commit();
  }

  const postflight = await verifyExistingRecords(rootRef, plan);
  if (postflight.missing.length || postflight.mismatches.length) throw new Error('Post-migration collection verification failed.');
  const currentSource = await source.ref.get();
  if (!currentSource.exists || stableHash(extractLegacyState(currentSource.data())) !== sourceHash) throw new Error('state/main changed during migration; cutover remains blocked.');

  const rootAfterWrites = await rootRef.get();
  if (rootAfterWrites.data().status !== 'VERIFIED') {
    await rootRef.update({
      status:'VERIFIED',
      verifiedAt:new Date().toISOString(),
      verification:{ counts:plan.manifest.counts, totals:plan.manifest.totals, sourceHash, exactContent:true }
    }, { lastUpdateTime:rootAfterWrites.updateTime });
  }
  const finalRoot = await rootRef.get();
  if (finalRoot.data().status !== 'VERIFIED') throw new Error('Migration did not reach VERIFIED.');
  return {
    action:preflight.missing.length ? 'APPLIED_VERIFIED' : 'NOOP_VERIFIED',
    backupPath:backupRef.path,
    businessUnitPath:rootRef.path,
    writes:preflight.missing.length,
    status:finalRoot.data().status,
    sourcePreserved:true,
    cutoverEnabled:false
  };
}

async function rollbackPlan({ db, plan, source, sourceHash, expectedSourceHash }) {
  if (sourceHash !== expectedSourceHash) throw new Error('Rollback source hash no longer matches state/main.');
  const { ownerUid, businessId } = plan.manifest;
  const rootRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
  const snapshot = await rootRef.get();
  if (!snapshot.exists) throw new Error('No modular businessUnit exists to roll back.');
  assertIdentity(snapshot.data(), boundary.identity(ownerUid, businessId), 'businessUnit');
  if (snapshot.data().sourceHash !== sourceHash) throw new Error('Rollback manifest belongs to another source snapshot.');
  await rootRef.update({
    status:'ROLLBACK_ONLY',
    rolledBackAt:new Date().toISOString(),
    rollback:{ sourcePath:source.ref.path, sourceHash, stateMainWriteCount:0, modularDocumentsDeleted:false }
  }, { lastUpdateTime:snapshot.updateTime });
  const verified = await rootRef.get();
  if (verified.data().status !== 'ROLLBACK_ONLY') throw new Error('Rollback status verification failed.');
  const currentSource = await source.ref.get();
  if (!currentSource.exists || stableHash(extractLegacyState(currentSource.data())) !== sourceHash) throw new Error('state/main changed during rollback.');
  return {
    action:'ROLLBACK_VERIFIED', businessUnitPath:rootRef.path, status:'ROLLBACK_ONLY',
    sourcePreserved:true, modularDocumentsDeleted:false, stateMainWriteCount:0
  };
}

async function promotePlan({ db, plan, source, sourceHash, expectedSourceHash }) {
  if (sourceHash !== expectedSourceHash) throw new Error('Promotion source hash no longer matches state/main.');
  const { ownerUid, businessId } = plan.manifest;
  const rootRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
  const snapshot = await rootRef.get();
  if (!snapshot.exists) throw new Error('Migration must reach VERIFIED before promotion.');
  assertIdentity(snapshot.data(), boundary.identity(ownerUid, businessId), 'businessUnit');
  if (snapshot.data().sourceHash !== sourceHash) throw new Error('Promotion manifest belongs to another source snapshot.');
  if (snapshot.data().status === 'CUTOVER_VERIFIED') {
    return { action:'NOOP_CUTOVER_VERIFIED', businessUnitPath:rootRef.path, status:'CUTOVER_VERIFIED', stateMainWriteCount:0 };
  }
  if (snapshot.data().status !== 'VERIFIED') throw new Error(`Promotion requires VERIFIED, received ${snapshot.data().status}.`);
  const records = await verifyExistingRecords(rootRef, plan);
  if (records.missing.length || records.mismatches.length) throw new Error('Promotion equivalence check failed.');
  const currentSource = await source.ref.get();
  if (!currentSource.exists || stableHash(extractLegacyState(currentSource.data())) !== sourceHash) throw new Error('state/main changed before promotion.');
  await rootRef.update({
    status:'CUTOVER_VERIFIED',
    cutoverVerifiedAt:new Date().toISOString(),
    cutover:{ sourcePath:source.ref.path, sourceHash, exactContent:true, dualWrite:false, stateMainWriteCount:0 }
  }, { lastUpdateTime:snapshot.updateTime });
  const verified = await rootRef.get();
  if (verified.data().status !== 'CUTOVER_VERIFIED') throw new Error('Cutover verification failed.');
  return {
    action:'CUTOVER_VERIFIED', businessUnitPath:rootRef.path, status:'CUTOVER_VERIFIED',
    sourcePreserved:true, dualWrite:false, stateMainWriteCount:0
  };
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
const apply = args.apply === true;
const rollback = args.rollback === true;
const promote = args.promote === true;
if (!boundary) throw new Error('Worker boundary module did not initialize.');
if (projectId === PRODUCTION_PROJECT) throw new Error('Production is forbidden for worker boundary migration.');
if (projectId !== STAGING_PROJECT) throw new Error(`Unapproved staging project: ${projectId}`);
if (!args.owner || !args.business) throw new Error('--owner and --business are required.');
if ([apply, rollback, promote].filter(Boolean).length > 1) throw new Error('--apply, --promote and --rollback are mutually exclusive.');
if (apply && args.confirm !== 'APPLY_STAGING_WORKER_BOUNDARY') throw new Error('--apply requires --confirm=APPLY_STAGING_WORKER_BOUNDARY.');
if (rollback && args.confirm !== 'ROLLBACK_STAGING_WORKER_BOUNDARY') throw new Error('--rollback requires --confirm=ROLLBACK_STAGING_WORKER_BOUNDARY.');
if (promote && args.confirm !== 'PROMOTE_STAGING_WORKER_BOUNDARY') throw new Error('--promote requires --confirm=PROMOTE_STAGING_WORKER_BOUNDARY.');
if ((apply || rollback || promote) && !args['source-hash']) throw new Error('--apply/--promote/--rollback requires --source-hash from the reviewed dry-run.');

let db;
let source;
if (args.input) {
  const raw = await loadJson(args.input);
  source = { raw, state:extractLegacyState(raw), updateTime:'fixture', ref:null };
  // Fixture-based sources do not carry a payload wrapper; identity validation is skipped.
  // Fixture runs are DRY_RUN only (enforced below) and never reach CUTOVER_VERIFIED.
} else {
  db = await connectAdmin(projectId);
  source = await sourceFromFirestore(db, String(args.owner));
  // Validate canonical identity BEFORE planning. A Firestore document without
  // payload.identity will be accepted by extractLegacyState but rejected at
  // runtime by p0-tenant-guard. We block here to prevent a false CUTOVER_VERIFIED.
  const expectedTenantKey = boundary.identity(String(args.owner), String(args.business)).tenantKey;
  validateSourceDocumentIdentity(source.raw, String(args.owner), String(args.business), expectedTenantKey);
}
if ((apply || rollback || promote) && args.input) throw new Error('Apply/promote/rollback must reread the staging state/main source; fixture execution is forbidden.');

const members = args.members ? await loadJson(args.members) : [];
const sourceHash = stableHash(source.state);
const generatedAt = String(args['generated-at'] || '1970-01-01T00:00:00.000Z');
const plan = boundary.planMigration(source.state, {
  ownerUid:String(args.owner), businessId:String(args.business), members,
  sourceRevision:Number(source.raw?.revision || source.raw?.payload?.revision || 0), sourceHash, generatedAt
});
const validation = boundary.validateMigrationPlan(plan);
if (!validation.valid) throw new Error(`Migration plan invalid: ${validation.errors.join(', ')}`);

const report = {
  projectId,
  mode:apply ? 'APPLY_STAGING' : promote ? 'PROMOTE_STAGING' : rollback ? 'ROLLBACK_STAGING' : 'DRY_RUN',
  sourcePath:`businesses/${args.owner}/state/main`,
  sourceHash,
  stateMainWriteCount:0,
  plan:{ manifest:plan.manifest, validation, documentCount:writeEntries(plan).length },
  result:apply
    ? await applyPlan({ db, plan, source, sourceHash, expectedSourceHash:String(args['source-hash']) })
    : promote
      ? await promotePlan({ db, plan, source, sourceHash, expectedSourceHash:String(args['source-hash']) })
      : rollback
        ? await rollbackPlan({ db, plan, source, sourceHash, expectedSourceHash:String(args['source-hash']) })
        : { action:'DRY_RUN_VERIFIED', writePolicy:'create_only', sourcePreserved:true, cutoverEnabled:false }
};

if (args.output) {
  await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive:true });
  await fs.writeFile(path.resolve(args.output), `${JSON.stringify({ ...report, collections:plan.collections }, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
