import fs from 'node:fs/promises';
import path from 'node:path';
import { stableHash } from './lib/click360-data-core.mjs';
import { normalizeOwnerAccessAssessment } from './lib/click360-owner-access-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inlineValue] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inlineValue ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const REQUIRED_PROJECT_ID = 'click-360';
const projectId = args.project || REQUIRED_PROJECT_ID;
if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
const apply = args.apply === true;
if (apply && !args.uid && !args.allowlist) throw new Error('--apply requires --uid or --allowlist. Bulk normalization is not supported.');

async function readAllowlist(file) {
  const values = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) throw new Error('Allowlist must be a JSON array of UIDs.');
  return new Set(values);
}

async function loadFirebase() {
  const [{ initializeApp, applicationDefault, cert, getApps }, { getFirestore, FieldValue }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore'), import('firebase-admin/auth')
  ]);
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? cert(JSON.parse(await fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')))
    : applicationDefault();
  const app = getApps()[0] || initializeApp({ credential, projectId });
  return { db: getFirestore(app), auth: getAuth(app), FieldValue };
}

const selected = new Set();
if (args.uid) selected.add(String(args.uid));
if (args.allowlist) for (const uid of await readAllowlist(args.allowlist)) selected.add(uid);
if (selected.size === 0) throw new Error('Provide --uid or --allowlist.');

const { db, auth, FieldValue } = await loadFirebase();
const results = [];

for (const uid of selected) {
  const approvedRef = db.collection('approvedUsers').doc(uid);
  const stateRef = db.collection('businesses').doc(uid).collection('state').doc('main');
  const [approvedSnap, stateSnap, authUser] = await Promise.all([
    approvedRef.get(), stateRef.get(), auth.getUser(uid).catch(() => null)
  ]);
  const original = approvedSnap.exists ? approvedSnap.data() || {} : null;
  const stateDocument = stateSnap.exists ? stateSnap.data() || {} : null;
  const assessment = normalizeOwnerAccessAssessment({ uid, approvedUser: original, authUser, stateDocument });
  const sourceHash = original ? stableHash(original) : null;
  const result = { uid, action: assessment.action, reasons: assessment.reasons, observations: assessment.observations, patch: assessment.patch, sourceHash };

  if (!assessment.allowed || assessment.action === 'ALREADY_NORMALIZED' || !apply) {
    results.push(result);
    continue;
  }

  const backupRef = approvedRef.collection('administrativeBackups').doc(`owner-access-v10-${Date.now()}`);
  await backupRef.create({
    source: 'approved_owner_access_v10_before_normalization',
    sourceHash,
    originalDocument: original,
    backedUpAt: new Date().toISOString(),
    backedUpBy: uid
  });
  const backup = await backupRef.get();
  if (!backup.exists || backup.data().sourceHash !== sourceHash || stableHash(backup.data().originalDocument) !== sourceHash) {
    throw new Error(`Backup verification failed for ${uid}; access record was not changed.`);
  }

  await db.runTransaction(async (transaction) => {
    const [currentApproved, currentState, currentBackup] = await Promise.all([
      transaction.get(approvedRef), transaction.get(stateRef), transaction.get(backupRef)
    ]);
    if (!currentApproved.exists || stableHash(currentApproved.data() || {}) !== sourceHash) throw new Error(`Approved-user record changed for ${uid}; normalization aborted.`);
    if (!currentBackup.exists || currentBackup.data().sourceHash !== sourceHash) throw new Error(`Backup changed for ${uid}; normalization aborted.`);
    const currentAssessment = normalizeOwnerAccessAssessment({
      uid,
      approvedUser: currentApproved.data() || {},
      authUser,
      stateDocument: currentState.exists ? currentState.data() || {} : null
    });
    if (!currentAssessment.allowed || currentAssessment.action !== 'NORMALIZATION_REQUIRED') {
      throw new Error(`Owner-access preconditions changed for ${uid}; normalization aborted.`);
    }
    transaction.update(approvedRef, { ...currentAssessment.patch, updatedAt: FieldValue.serverTimestamp() });
  });

  const verified = await approvedRef.get();
  const verifiedAssessment = normalizeOwnerAccessAssessment({ uid, approvedUser: verified.data() || {}, authUser, stateDocument });
  if (!verifiedAssessment.allowed || verifiedAssessment.action !== 'ALREADY_NORMALIZED') {
    throw new Error(`Post-normalization verification failed for ${uid}.`);
  }
  result.action = 'APPLIED_VERIFIED';
  result.backupPath = backupRef.path;
  result.backupVerified = true;
  results.push(result);
}

console.log(JSON.stringify({ projectId, mode: apply ? 'APPLY' : 'DRY_RUN', results }, null, 2));
