import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  REQUIRED_PROJECT_ID,
  activationConfirmation,
  activationFields,
  assertAdminScope,
  firestoreHash,
  normalizeEmail,
  plainFirestoreValue,
  stateIdentitySummary,
  suspendConfirmation
} from '../lib/click360-v16-admin-core.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function expiryTimestamp(period) {
  const months = { month: 1, quarter: 3, semester: 6, year: 12 }[period];
  if (!months) return null;
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return Timestamp.fromDate(date);
}

const args = parseArgs(process.argv.slice(2));
const command = String(args.command || 'inspect').toLowerCase();
const projectId = String(args.project || REQUIRED_PROJECT_ID);
const actorEmail = normalizeEmail(args.actor);
const expectedEmail = normalizeEmail(args.email);
const expectedUid = String(args.uid || '');
const apply = args.apply === true;

if (projectId !== REQUIRED_PROJECT_ID) throw new Error(`Refusing project ${projectId}. Only ${REQUIRED_PROJECT_ID} is allowed.`);
if (!actorEmail) throw new Error('--actor is required.');
if (!expectedEmail) throw new Error('--email is required.');
if (!['inspect', 'activate', 'suspend'].includes(command)) throw new Error('Use --command inspect, activate, or suspend.');
if (apply && !expectedUid) throw new Error('--apply requires the exact --uid.');
if (apply && !args['expected-before-hash']) throw new Error('--apply requires --expected-before-hash from a fresh dry-run.');

const app = initializeApp({ credential: applicationDefault(), projectId }, `click360-v16-admin-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const authUser = await auth.getUserByEmail(expectedEmail);
const uid = authUser.uid;
const accountRef = db.collection('accountAccess').doc(uid);
const approvedRef = db.collection('approvedUsers').doc(uid);
const stateRef = db.collection('businesses').doc(uid).collection('state').doc('main');
const [accountSnap, approvedSnap, stateSnap, membersSnap, invitesSnap, requestsSnap] = await Promise.all([
  accountRef.get(),
  approvedRef.get(),
  stateRef.get(),
  db.collection('businesses').doc(uid).collection('members').get(),
  db.collection('businesses').doc(uid).collection('invitations').get(),
  db.collection('activationRequests').where('uid', '==', uid).get()
]);
const account = accountSnap.exists ? accountSnap.data() || {} : null;
const approved = approvedSnap.exists ? approvedSnap.data() || {} : null;
const stateDocument = stateSnap.exists ? stateSnap.data() || {} : null;
const scope = assertAdminScope({
  projectId,
  actorEmail,
  authUser,
  expectedUid: expectedUid || uid,
  expectedEmail,
  businessId: account?.businessId || uid
});
if (!scope.allowed) throw new Error(`Administrative scope rejected: ${scope.reasons.join(', ')}`);

const stateSummary = stateIdentitySummary(stateDocument, uid);
const beforeHash = firestoreHash(account);
const inspection = {
  projectId,
  mode: apply ? 'APPLY' : 'DRY_RUN',
  command,
  identity: { uid, email: normalizeEmail(authUser.email), disabled: authUser.disabled === true },
  accountAccess: account ? {
    status: account.status || null,
    plan: account.planCode || account.plan || null,
    source: account.source || null,
    revision: Number(account.revision || 0),
    businessId: account.businessId || null,
    beforeHash
  } : { exists: false, beforeHash },
  approvedUser: approved ? { exists: true, role: approved.role || null, status: approved.status || null, ownerId: approved.ownerId || null } : { exists: false },
  tenant: stateSummary,
  related: {
    members: membersSnap.size,
    invitations: invitesSnap.size,
    activationRequests: requestsSnap.size,
    pendingActivationRequests: requestsSnap.docs.filter((doc) => doc.data()?.status === 'pending').length
  }
};

if (command === 'inspect') {
  console.log(JSON.stringify(inspection, null, 2));
  process.exit(0);
}

const plan = String(args.plan || 'base').toLowerCase();
const period = String(args.period || 'historical').toLowerCase();
const expectedConfirmation = command === 'activate'
  ? activationConfirmation(uid, plan, period)
  : suspendConfirmation(uid);
inspection.proposed = command === 'activate'
  ? activationFields({ existing: account || {}, authUser, actorEmail, plan, period })
  : { status: 'suspended', revision: Math.max(0, Number(account?.revision || 0)) + 1, suspendedBy: actorEmail };
inspection.requiredConfirmation = expectedConfirmation;

if (!apply) {
  console.log(JSON.stringify(inspection, null, 2));
  process.exit(0);
}
if (String(args.confirm || '') !== expectedConfirmation) throw new Error(`Confirmation mismatch. Expected: ${expectedConfirmation}`);
if (String(args['expected-before-hash']) !== beforeHash) throw new Error('The supplied before hash does not match the fresh accountAccess document.');

const backupRef = db.collection('adminBackups').doc();
await backupRef.create({
  backupId: backupRef.id,
  projectId,
  action: command,
  targetPath: accountRef.path,
  uid,
  email: expectedEmail,
  actorEmail,
  beforeHash,
  beforeAccess: account,
  tenantIdentity: stateSummary,
  createdAt: FieldValue.serverTimestamp(),
  appVersion: '16.2.0'
});
const verifiedBackup = await backupRef.get();
if (!verifiedBackup.exists || verifiedBackup.data()?.beforeHash !== beforeHash
  || firestoreHash(verifiedBackup.data()?.beforeAccess ?? null) !== beforeHash) {
  throw new Error('Administrative backup verification failed. No access change was attempted.');
}

const auditRef = db.collection('adminAuditLogs').doc();
const requestId = args['request-id'] ? String(args['request-id']) : '';
const requestRef = requestId ? db.collection('activationRequests').doc(requestId) : null;
await db.runTransaction(async (transaction) => {
  const reads = [transaction.get(accountRef), transaction.get(backupRef)];
  if (requestRef) reads.push(transaction.get(requestRef));
  const [currentAccountSnap, currentBackupSnap, requestSnap] = await Promise.all(reads);
  const currentAccount = currentAccountSnap.exists ? currentAccountSnap.data() || {} : null;
  if (firestoreHash(currentAccount) !== beforeHash) throw new Error('accountAccess changed after backup; operation aborted.');
  if (!currentBackupSnap.exists || currentBackupSnap.data()?.beforeHash !== beforeHash) throw new Error('Verified backup is no longer available.');

  let patch;
  if (command === 'activate') {
    patch = {
      ...activationFields({ existing: currentAccount || {}, authUser, actorEmail, plan, period }),
      activatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSeenAt: currentAccount?.lastSeenAt || FieldValue.serverTimestamp(),
      createdAt: currentAccount?.createdAt || FieldValue.serverTimestamp()
    };
    const expiresAt = expiryTimestamp(period);
    if (expiresAt) patch.expiresAt = expiresAt;
    else if (currentAccountSnap.exists && currentAccount?.expiresAt) patch.expiresAt = FieldValue.delete();
    transaction.set(accountRef, patch, { merge: true });
    if (requestRef) {
      const request = requestSnap?.exists ? requestSnap.data() || {} : null;
      if (!request || request.uid !== uid || request.status !== 'pending' || request.plan !== plan) {
        throw new Error('Activation request does not match the target UID, plan, and pending status.');
      }
      transaction.update(requestRef, {
        status: 'approved', approvedAt: FieldValue.serverTimestamp(), approvedBy: actorEmail, accountRevision: patch.revision
      });
    }
  } else {
    if (!currentAccountSnap.exists) throw new Error('Cannot suspend a missing accountAccess document.');
    patch = {
      status: 'suspended',
      revision: Math.max(0, Number(currentAccount?.revision || 0)) + 1,
      suspendedAt: FieldValue.serverTimestamp(),
      suspendedBy: actorEmail,
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.update(accountRef, patch);
  }
  transaction.create(auditRef, {
    auditId: auditRef.id,
    projectId,
    action: command,
    targetPath: accountRef.path,
    uid,
    actorEmail,
    backupPath: backupRef.path,
    beforeHash,
    requestedAfter: plainFirestoreValue(patch),
    confirmation: expectedConfirmation,
    createdAt: FieldValue.serverTimestamp(),
    appVersion: '16.2.0'
  });
});

const [afterSnap, stateAfterSnap, auditAfterSnap] = await Promise.all([accountRef.get(), stateRef.get(), auditRef.get()]);
const after = afterSnap.data() || {};
const stateAfter = stateAfterSnap.exists ? stateAfterSnap.data() || {} : null;
const afterStateSummary = stateIdentitySummary(stateAfter, uid);
if (!auditAfterSnap.exists) throw new Error('Administrative audit verification failed.');
if (stateSummary.stateHash !== afterStateSummary.stateHash) throw new Error('Tenant state changed during access administration.');
if (command === 'activate' && (after.status !== inspection.proposed.status || after.planCode !== plan || after.uid !== uid || after.businessId !== uid)) {
  throw new Error('Activation post-verification failed.');
}
if (command === 'suspend' && after.status !== 'suspended') throw new Error('Suspension post-verification failed.');

console.log(JSON.stringify({
  ...inspection,
  result: 'APPLIED_VERIFIED',
  backupPath: backupRef.path,
  auditPath: auditRef.path,
  after: {
    status: after.status,
    plan: after.planCode || after.plan,
    revision: Number(after.revision || 0),
    accountHash: firestoreHash(after),
    tenantHashUnchanged: stateSummary.stateHash === afterStateSummary.stateHash
  }
}, null, 2));
