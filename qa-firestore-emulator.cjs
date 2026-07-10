const assert = require('assert');
const fs = require('fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-p0-rules';

function ownerProfile(uid, email, approved = true) {
  return {
    uid,
    email,
    role: 'owner',
    isOwner: true,
    ownerId: uid,
    status: 'active',
    approved
  };
}

function workerProfile(uid, email, ownerId) {
  return {
    uid,
    email,
    role: 'worker',
    isOwner: false,
    ownerId,
    status: 'active',
    approved: true,
    name: 'Worker',
    photoURL: '',
    businessLimit: 2,
    approvedFromEmail: true,
    createdAt: 1
  };
}

function invite(email, ownerId) {
  return {
    email,
    role: 'worker',
    ownerId,
    inviteToken: 'test-token',
    status: 'active',
    approved: true,
    name: 'Worker',
    businessLimit: 2,
    createdAt: 1
  };
}

function state(ownerId, revision = 1) {
  const tenantKey = `owner:${ownerId}:business:${ownerId}`;
  return {
    schemaVersion: 10,
    ownerUid: ownerId,
    ownerId,
    businessId: ownerId,
    tenantKey,
    revision,
    payload: {
      schemaVersion: 10,
      identity: {
        schemaVersion: 10,
        ownerUid: ownerId,
        ownerId,
        businessId: ownerId,
        tenantKey
      },
      data: {
        businesses: [{ id: 'biz_main' }],
        products: [],
        sales: [],
        movements: [],
        invoices: [],
        dailyReports: [],
        deletedProducts: [],
        auditLogs: [],
        settings: { workers: [], labelTemplates: [] }
      }
    }
  };
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES }
  });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', 'owner-a'), ownerProfile('owner-a', 'owner-a@example.test'));
      await setDoc(doc(db, 'approvedUsers', 'owner-b'), ownerProfile('owner-b', 'owner-b@example.test'));
      await setDoc(doc(db, 'approvedUsers', 'active-not-approved'), ownerProfile('active-not-approved', 'not-approved@example.test', false));
      await setDoc(doc(db, 'approvedUsers', 'worker-a'), workerProfile('worker-a', 'worker-a@example.test', 'owner-a'));
      await setDoc(doc(db, 'approvedUsers', 'self-worker'), workerProfile('self-worker', 'self-worker@example.test', 'self-worker'));
      await setDoc(doc(db, 'approvedUsersByEmail', 'worker-a@example.test'), invite('worker-a@example.test', 'owner-a'));
    });

    const ownerA = env.authenticatedContext('owner-a', { email: 'owner-a@example.test' }).firestore();
    const ownerB = env.authenticatedContext('owner-b', { email: 'owner-b@example.test' }).firestore();
    const workerA = env.authenticatedContext('worker-a', { email: 'worker-a@example.test' }).firestore();
    const notApproved = env.authenticatedContext('active-not-approved', { email: 'not-approved@example.test' }).firestore();
    const attacker = env.authenticatedContext('attacker', { email: 'attacker@example.test' }).firestore();
    const selfWorker = env.authenticatedContext('self-worker', { email: 'self-worker@example.test' }).firestore();
    const unauthenticated = env.unauthenticatedContext().firestore();
    const stateA = doc(ownerA, 'businesses', 'owner-a', 'state', 'main');
    const stateB = doc(ownerB, 'businesses', 'owner-b', 'state', 'main');

    await assertSucceeds(setDoc(stateA, state('owner-a')));
    await assertSucceeds(getDoc(stateA));
    await assertFails(getDoc(doc(ownerB, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(workerA, 'businesses', 'owner-b', 'state', 'main')));
    await assertFails(getDoc(doc(notApproved, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(unauthenticated, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(selfWorker, 'businesses', 'self-worker', 'state', 'main')));
    await assertSucceeds(getDoc(doc(ownerA, 'approvedUsers', 'worker-a')));
    await assertFails(getDoc(doc(ownerA, 'approvedUsers', 'owner-b')));
    await assertFails(getDoc(doc(ownerB, 'approvedUsers', 'worker-a')));
    await assertSucceeds(getDoc(doc(ownerA, 'approvedUsersByEmail', 'worker-a@example.test')));
    await assertFails(getDoc(doc(ownerB, 'approvedUsersByEmail', 'worker-a@example.test')));
    await assertSucceeds(getDocs(query(
      collection(ownerA, 'approvedUsers'),
      where('ownerId', '==', 'owner-a'),
      where('role', '==', 'worker')
    )));

    await assertFails(setDoc(stateB, state('owner-a')));
    await assertFails(setDoc(stateA, {
      ...state('owner-a', 2),
      payload: { ...state('owner-a', 2).payload, identity: { ...state('owner-a', 2).payload.identity, schemaVersion: 9 } }
    }));
    await assertFails(setDoc(doc(ownerA, 'businesses', 'owner-a', 'legacyBackups', 'test'), { original: true }));

    await assertSucceeds(getDoc(doc(workerA, 'businesses', 'owner-a', 'state', 'main')));
    await assertSucceeds(setDoc(doc(workerA, 'businesses', 'owner-a', 'state', 'main'), state('owner-a', 2)));
    await assertFails(setDoc(doc(attacker, 'approvedUsers', 'attacker'), ownerProfile('attacker', 'attacker@example.test')));

    const newWorkerEmail = 'new-worker@example.test';
    await assertSucceeds(setDoc(doc(ownerA, 'approvedUsersByEmail', newWorkerEmail), invite(newWorkerEmail, 'owner-a')));
    const newWorker = env.authenticatedContext('new-worker', { email: newWorkerEmail }).firestore();
    await assertSucceeds(setDoc(doc(newWorker, 'approvedUsers', 'new-worker'), workerProfile('new-worker', newWorkerEmail, 'owner-a')));
    await assertSucceeds(updateDoc(doc(newWorker, 'approvedUsers', 'new-worker'), { name: 'Updated worker' }));
    await assertFails(updateDoc(doc(newWorker, 'approvedUsers', 'new-worker'), { name: 'x'.repeat(121), photoURL: '' }));
    await assertFails(updateDoc(doc(newWorker, 'approvedUsers', 'new-worker'), { role: 'owner' }));
    await assertFails(setDoc(doc(newWorker, 'approvedUsers', 'new-worker-two'), workerProfile('new-worker-two', newWorkerEmail, 'owner-a')));

    const revoke = writeBatch(ownerA);
    revoke.set(doc(ownerA, 'approvedUsersByEmail', 'worker-a@example.test'), {
      status: 'blocked', approved: false, revokedAt: 2, revokedBy: 'owner-a'
    }, { merge: true });
    revoke.set(doc(ownerA, 'approvedUsers', 'worker-a'), {
      status: 'blocked', approved: false, revokedAt: 2, revokedBy: 'owner-a'
    }, { merge: true });
    await assertSucceeds(revoke.commit());
    await assertFails(updateDoc(doc(workerA, 'approvedUsers', 'worker-a'), { name: 'Revoked mutation', photoURL: '' }));
    await assertFails(getDoc(doc(workerA, 'businesses', 'owner-a', 'state', 'main')));

    const stored = await getDoc(doc(ownerA, 'businesses', 'owner-a', 'state', 'main'));
    assert.strictEqual(stored.data().revision, 2, 'the authorized shared worker write reaches only owner-a state');
    console.log('PASS Firestore emulator: tenant reads/writes, approval, invite, revocation boundaries, and legacy backups');
    console.log('PASS Firestore emulator: active-but-unapproved and cross-tenant attempts are denied');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
