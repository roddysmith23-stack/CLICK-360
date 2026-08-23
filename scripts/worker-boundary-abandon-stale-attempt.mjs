/**
 * Abandon a stale Worker Data Boundary migration attempt whose businessUnit
 * root's sourceHash no longer matches the live state/main document.
 *
 * worker-boundary-migrate.mjs has no command for this on purpose: --apply
 * requires an exact sourceHash match to resume, --promote requires the same,
 * and --rollback ALSO re-verifies the CURRENT live hash against the
 * businessUnit's stored hash before it will even touch it. All three
 * correctly refuse when state/main has legitimately changed since the
 * attempt (see SHARY: her real business kept operating -- new sales, new
 * products -- while the migration sat at VERIFIED, so its snapshot went
 * stale). That refusal is the tool doing its job: it must never guess.
 *
 * This script is the explicit, narrow, audited "abandon and restart" step
 * that decision requires. It is destructive ONLY within
 * businesses/{ownerUid}/businessUnits/{businessId} (the never-activated
 * modular shadow copy) and NEVER touches businesses/{ownerUid}/state/main
 * (the tenant's real, live system of record) or featureFlags/workers (the
 * Workers-OFF invariant, left untouched so re-migration still starts dark).
 * A businessUnit is only eligible for abandonment if its status is anything
 * other than CUTOVER_VERIFIED (a live cutover is never abandoned by this
 * tool -- that would be a real rollback, a different and more dangerous
 * operation this script deliberately does not perform).
 *
 * Every document under the businessUnit (root + every subcollection) is
 * mirrored to adminBackups/{backupId}/mirror/{collection}/{docId} and
 * verified present before any delete, then deleted, then the deletion is
 * verified complete.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { REQUIRED_PROJECT_ID, normalizeEmail } from './lib/click360-v16-admin-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || REQUIRED_PROJECT_ID);
const actorEmail = normalizeEmail(args.actor);
const ownerUid = String(args.owner || '');
const businessId = String(args.business || '');
const apply = args.apply === true;
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
if (!actorEmail) throw new Error('--actor is required.');
if (!ownerUid || !businessId) throw new Error('--owner and --business are required.');
if (apply && args.confirm !== `ABANDON_STALE_WORKER_BOUNDARY:${ownerUid}:${businessId}`) {
  throw new Error(`--apply requires --confirm=ABANDON_STALE_WORKER_BOUNDARY:${ownerUid}:${businessId}`);
}

const app = initializeApp({ credential: applicationDefault(), projectId }, `worker-boundary-abandon-${Date.now()}`);
const db = getFirestore(app);

const rootRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
const rootSnap = await rootRef.get();
if (!rootSnap.exists) throw new Error('No businessUnit exists at this path; nothing to abandon.');
const rootData = rootSnap.data();
if (rootData.status === 'CUTOVER_VERIFIED') {
  throw new Error('Refusing to abandon a CUTOVER_VERIFIED businessUnit -- this tool only abandons a never-cut-over staging attempt. Use worker-boundary-deactivate-tenant.mjs for a live cutover instead.');
}

const collectionsRefs = await rootRef.listCollections();
const inventory = [];
for (const collectionRef of collectionsRefs) {
  const docsSnap = await collectionRef.get();
  inventory.push({ collectionId: collectionRef.id, docIds: docsSnap.docs.map((doc) => doc.id), docCount: docsSnap.size });
}
const totalDocCount = inventory.reduce((sum, entry) => sum + entry.docCount, 0);

const inspection = {
  projectId,
  mode: apply ? 'APPLY' : 'DRY_RUN',
  target: { ownerUid, businessId },
  currentStatus: rootData.status,
  currentSourceHash: rootData.sourceHash || null,
  inventory: inventory.map((entry) => ({ collectionId: entry.collectionId, docCount: entry.docCount })),
  totalDocCount: totalDocCount + 1
};

if (!apply) {
  console.log(JSON.stringify(inspection, null, 2));
  process.exit(0);
}

const backupRef = db.collection('adminBackups').doc();
await backupRef.create({
  backupId: backupRef.id,
  projectId,
  action: 'worker_boundary_abandon_stale_attempt',
  targetPath: rootRef.path,
  ownerUid,
  businessId,
  actorEmail,
  beforeStatus: rootData.status,
  beforeSourceHash: rootData.sourceHash || null,
  inventory: inventory.map((entry) => ({ collectionId: entry.collectionId, docCount: entry.docCount })),
  createdAt: FieldValue.serverTimestamp(),
  appVersion: '16.2.0'
});

// Mirror every document (root + every subcollection doc) into the backup
// before deleting anything.
const mirrorRootRef = backupRef.collection('mirror').doc('_root');
await mirrorRootRef.set(rootData);
for (const entry of inventory) {
  const collectionRef = rootRef.collection(entry.collectionId);
  const docsSnap = await collectionRef.get();
  for (let offset = 0; offset < docsSnap.docs.length; offset += 400) {
    const batch = db.batch();
    docsSnap.docs.slice(offset, offset + 400).forEach((doc) => {
      batch.set(backupRef.collection('mirror').doc(`${entry.collectionId}__${doc.id}`), { collectionId: entry.collectionId, docId: doc.id, data: doc.data() });
    });
    await batch.commit();
  }
}

// Verify the mirror is complete before deleting anything live.
const mirrorSnap = await backupRef.collection('mirror').get();
if (mirrorSnap.size !== totalDocCount + 1) {
  throw new Error(`Backup mirror verification failed: expected ${totalDocCount + 1} documents (root + subcollections), found ${mirrorSnap.size}. No delete was attempted.`);
}

// Delete every subcollection document, then the root.
for (const entry of inventory) {
  const collectionRef = rootRef.collection(entry.collectionId);
  const docsSnap = await collectionRef.get();
  for (let offset = 0; offset < docsSnap.docs.length; offset += 400) {
    const batch = db.batch();
    docsSnap.docs.slice(offset, offset + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}
await rootRef.delete();

// Verify deletion: root gone, every subcollection empty.
const rootAfter = await rootRef.get();
if (rootAfter.exists) throw new Error('Post-verification failed: businessUnit root still exists after delete.');
const remainingCollections = await rootRef.listCollections();
const stillPopulated = [];
for (const collectionRef of remainingCollections) {
  const snap = await collectionRef.limit(1).get();
  if (!snap.empty) stillPopulated.push(collectionRef.id);
}
if (stillPopulated.length) throw new Error(`Post-verification failed: subcollections still populated: ${stillPopulated.join(', ')}`);

const auditRef = db.collection('adminAuditLogs').doc();
await auditRef.set({
  auditId: auditRef.id,
  projectId,
  action: 'worker_boundary_abandon_stale_attempt',
  targetPath: rootRef.path,
  ownerUid,
  businessId,
  actorEmail,
  backupPath: backupRef.path,
  beforeStatus: rootData.status,
  beforeSourceHash: rootData.sourceHash || null,
  documentsDeleted: totalDocCount + 1,
  createdAt: FieldValue.serverTimestamp(),
  appVersion: '16.2.0'
});

console.log(JSON.stringify({
  ...inspection,
  result: 'ABANDONED_VERIFIED',
  backupPath: backupRef.path,
  auditPath: auditRef.path,
  documentsDeleted: totalDocCount + 1
}, null, 2));
