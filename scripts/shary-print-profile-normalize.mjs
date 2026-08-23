/**
 * One-off, minimal, reversible data fix for SHARY's stored print geometry.
 *
 * Root cause (see the forensic trace this codifies): SHARY's 1 label profile
 * and 4 label templates all carry mediaWidthMm:800 -- almost certainly a
 * data-entry typo for ~80mm from a July session, propagated by template
 * duplication. The r33 SANITY_FACTOR fix in app.js' universalMediaSize()
 * ALREADY discards this stale value today (800 > naturalWidth*1.6 in every
 * traced case) and falls back to the correct computed natural page size --
 * so this is a data cleanup, not a code fix. Setting mediaWidthMm to 0 makes
 * that already-correct fallback explicit and permanent instead of relying on
 * a sanity-check discarding a wrong stored number every time she prints.
 *
 * Scope is intentionally hardcoded to SHARY alone (not a generic tool) --
 * this is a named, investigated, one-tenant fix, isolated per the release's
 * own instruction to never let one tenant's issue block or widen into a
 * general mechanism.
 *
 * Safety pattern mirrors admin-access-v16.mjs: dry-run by default, explicit
 * --apply + --confirm + --expected-before-hash, transactional re-verification
 * of the live hash immediately before writing, a full pre-change backup, an
 * audit log entry, and a post-write structural proof that nothing except the
 * 5 targeted mediaWidthMm fields changed.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { assertAdminScope, firestoreHash, normalizeEmail, REQUIRED_PROJECT_ID } from './lib/click360-v16-admin-core.mjs';

const SHARY_UID = '3UTjgHd1QNSvqlcXNKQ6tL79X7u2';
const SHARY_EMAIL = 'shary10mmvv@gmail.com';

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
const apply = args.apply === true;
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
if (!actorEmail) throw new Error('--actor is required.');
if (apply && !args['expected-before-hash']) throw new Error('--apply requires --expected-before-hash from a fresh dry-run.');

const app = initializeApp({ credential: applicationDefault(), projectId }, `shary-print-normalize-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const authUser = await auth.getUserByEmail(SHARY_EMAIL);
if (authUser.uid !== SHARY_UID) throw new Error('Identity mismatch: refusing to touch a UID other than the investigated SHARY account.');

const scope = assertAdminScope({ projectId, actorEmail, authUser, expectedUid: SHARY_UID, expectedEmail: SHARY_EMAIL, businessId: SHARY_UID });
if (!scope.allowed) throw new Error(`Administrative scope rejected: ${scope.reasons.join(', ')}`);

const stateRef = db.collection('businesses').doc(SHARY_UID).collection('state').doc('main');
const snap = await stateRef.get();
if (!snap.exists) throw new Error('state/main not found for SHARY.');
const document = snap.data();
const beforeHash = firestoreHash(document);

function targets(doc) {
  const settings = doc?.payload?.data?.settings || {};
  const profiles = Array.isArray(settings.labelProfiles) ? settings.labelProfiles : [];
  const templates = Array.isArray(settings.labelTemplates) ? settings.labelTemplates : [];
  return { profiles, templates };
}

const { profiles, templates } = targets(document);
if (profiles.length !== 1) throw new Error(`Expected exactly 1 label profile, found ${profiles.length}. Re-investigate before applying.`);
if (templates.length !== 4) throw new Error(`Expected exactly 4 label templates, found ${templates.length}. Re-investigate before applying.`);
if (profiles[0]?.paper?.mediaWidthMm !== 800) throw new Error(`Profile mediaWidthMm is ${profiles[0]?.paper?.mediaWidthMm}, not the expected stale 800. Re-investigate before applying.`);
templates.forEach((template, index) => {
  if (template.mediaWidthMm !== 800) throw new Error(`Template #${index} (${template.name}) mediaWidthMm is ${template.mediaWidthMm}, not the expected stale 800. Re-investigate before applying.`);
});

const inspection = {
  projectId,
  mode: apply ? 'APPLY' : 'DRY_RUN',
  target: { uid: SHARY_UID, email: SHARY_EMAIL },
  beforeHash,
  proposed: {
    profile: { id: profiles[0].id, name: profiles[0].paper?.name, mediaWidthMm: '800 -> 0' },
    templates: templates.map((template) => ({ id: template.id, name: template.name, mediaWidthMm: '800 -> 0' }))
  }
};

if (!apply) {
  console.log(JSON.stringify(inspection, null, 2));
  process.exit(0);
}
if (String(args['expected-before-hash']) !== beforeHash) throw new Error('The supplied before hash does not match the fresh state/main document.');

const backupRef = db.collection('adminBackups').doc();
await backupRef.create({
  backupId: backupRef.id,
  projectId,
  action: 'shary_print_profile_normalize',
  targetPath: stateRef.path,
  uid: SHARY_UID,
  actorEmail,
  beforeHash,
  beforeState: document,
  createdAt: FieldValue.serverTimestamp(),
  appVersion: '16.2.0'
});
const verifiedBackup = await backupRef.get();
if (!verifiedBackup.exists || verifiedBackup.data()?.beforeHash !== beforeHash
  || firestoreHash(verifiedBackup.data()?.beforeState ?? null) !== beforeHash) {
  throw new Error('Administrative backup verification failed. No write was attempted.');
}

const auditRef = db.collection('adminAuditLogs').doc();
// Firestore field paths cannot address an array index directly, so the fix
// is written as two whole-array field values (labelProfiles, labelTemplates)
// via transaction.update() with an explicit field-path map -- never a
// structuredClone()+set() of the FULL document. A full-document clone would
// round-trip every field through JS, including the document's own top-level
// Firestore Timestamp fields (createdAt/updatedAt/lastSeenAt), silently
// degrading them to plain {_seconds,_nanoseconds} maps on write-back. This
// script was caught doing exactly that during development; see git history
// and adminAuditLogs for the corrective fix applied to the one document this
// bug reached before it was found. Scoping the write to only the two
// affected sub-arrays makes that failure mode structurally impossible here.
await db.runTransaction(async (transaction) => {
  const [currentSnap, currentBackupSnap] = await Promise.all([transaction.get(stateRef), transaction.get(backupRef)]);
  if (!currentSnap.exists) throw new Error('state/main disappeared between dry-run and apply.');
  const current = currentSnap.data();
  if (firestoreHash(current) !== beforeHash) throw new Error('state/main changed since the dry-run hash was computed; operation aborted (no partial write).');
  if (!currentBackupSnap.exists || currentBackupSnap.data()?.beforeHash !== beforeHash) throw new Error('Verified backup is no longer available.');

  const { profiles: currentProfiles, templates: currentTemplates } = targets(current);
  const nextProfiles = structuredClone(currentProfiles);
  const nextTemplates = structuredClone(currentTemplates);
  nextProfiles[0].paper.mediaWidthMm = 0;
  nextTemplates.forEach((template) => { template.mediaWidthMm = 0; });
  const nextRevision = Number(current.revision || 0) + 1;

  transaction.update(stateRef, {
    'payload.data.settings.labelProfiles': nextProfiles,
    'payload.data.settings.labelTemplates': nextTemplates,
    revision: nextRevision
  });
  transaction.create(auditRef, {
    auditId: auditRef.id,
    projectId,
    action: 'shary_print_profile_normalize',
    targetPath: stateRef.path,
    uid: SHARY_UID,
    actorEmail,
    backupPath: backupRef.path,
    beforeHash,
    fieldsChanged: ['payload.data.settings.labelProfiles[0].paper.mediaWidthMm', ...nextTemplates.map((t, i) => `payload.data.settings.labelTemplates[${i}].mediaWidthMm`)],
    createdAt: FieldValue.serverTimestamp(),
    appVersion: '16.2.0'
  });
});

const afterSnap = await stateRef.get();
const after = afterSnap.data();
const { profiles: afterProfiles, templates: afterTemplates } = targets(after);
if (afterProfiles[0]?.paper?.mediaWidthMm !== 0) throw new Error('Post-verification failed: profile mediaWidthMm was not written as 0.');
if (afterTemplates.some((template) => template.mediaWidthMm !== 0)) throw new Error('Post-verification failed: at least one template mediaWidthMm was not written as 0.');

// Structural proof that nothing else changed: a type-aware recursive diff
// against the pre-write backup must show ONLY the 5 targeted mediaWidthMm
// leaves and the revision counter -- this also catches a Timestamp-type
// silently degrading to a plain map even when its millisecond value is
// unchanged (a value-only diff would miss that; this does not).
function typeAwareDiff(a, b, path, diffs) {
  const aIsTs = Boolean(a && typeof a === 'object' && typeof a.toMillis === 'function');
  const bIsTs = Boolean(b && typeof b === 'object' && typeof b.toMillis === 'function');
  if (aIsTs !== bIsTs) { diffs.push(path); return; }
  if (aIsTs && bIsTs) { if (a.toMillis() !== b.toMillis()) diffs.push(path); return; }
  const isObjA = a && typeof a === 'object';
  const isObjB = b && typeof b === 'object';
  if (!isObjA || !isObjB) { if (a !== b) diffs.push(path); return; }
  const keys = new Set([...(Array.isArray(a) ? a.map((_, i) => i) : Object.keys(a)), ...(Array.isArray(b) ? b.map((_, i) => i) : Object.keys(b))]);
  for (const key of keys) typeAwareDiff(a[key], b[key], `${path}.${key}`, diffs);
}
const diffPaths = [];
typeAwareDiff(document, after, 'root', diffPaths);
const expectedDiffPaths = new Set([
  'root.revision',
  'root.payload.data.settings.labelProfiles.0.paper.mediaWidthMm',
  ...templates.map((template, index) => `root.payload.data.settings.labelTemplates.${index}.mediaWidthMm`)
]);
const unexpected = diffPaths.filter((path) => !expectedDiffPaths.has(path));
if (unexpected.length) throw new Error(`Post-verification failed: unexpected fields changed beyond the 5 targeted mediaWidthMm values + revision: ${JSON.stringify(unexpected)}. Investigate before trusting this write.`);

console.log(JSON.stringify({
  ...inspection,
  result: 'APPLIED_VERIFIED',
  backupPath: backupRef.path,
  auditPath: auditRef.path,
  afterHash: firestoreHash(after),
  structuralRoundtripProof: 'PASS: only the 5 targeted mediaWidthMm fields changed'
}, null, 2));
