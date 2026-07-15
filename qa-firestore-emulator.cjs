const assert = require('assert');
const fs = require('fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { Timestamp, collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } = require('firebase/firestore');

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

function workerPermissions() {
  return {
    inventory: { view: true, create: true, edit: true, delete: true, export: false, manage: false },
    sales: { view: true, create: true, edit: false, delete: false, approve: false, export: false, manage: false },
    cash: { view: true, create: true, edit: false, delete: false, approve: false, export: false, manage: false },
    customers: { view: true, create: true, edit: true, delete: false, export: false, manage: false },
    reports: { view: true, create: false, edit: false, delete: false, export: false, manage: false },
    reminders: { view: true, create: true, edit: true, delete: false, manage: false },
    settings: { view: false, edit: false, manage: false },
    suppliers: { view: true, create: false, edit: false, delete: false, manage: false },
    workers: { view: false, create: false, edit: false, delete: false, manage: false }
  };
}

function membership(uid, email, ownerId) {
  return {
    uid, email, name: 'Worker', role: 'worker', permissions: workerPermissions(), status: 'active',
    ownerId, businessId: ownerId, tenantKey: `owner:${ownerId}:business:${ownerId}`,
    invitationHash: 'legacy-worker-a', acceptedAt: 1, lastAccessAt: 1
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
        layaways: [],
        cashSessions: [],
        notifications: [],
        legalAcceptances: [],
        settings: { workers: [], labelTemplates: [], customers: [], reminders: [] }
      }
    }
  };
}

function telemetry(eventId, businessId, eventType = 'bootstrap') {
  return {
    eventId,
    eventType,
    uidHash: 'a'.repeat(16),
    businessId,
    tenantKey: `owner:${businessId}:business:${businessId}`,
    appVersion: '16.2.0',
    requestId: `request-${eventId}`,
    mode: 'ready',
    errorCode: '',
    deviceIdHash: 'b'.repeat(16),
    createdAt: serverTimestamp()
  };
}

function v16ApprovedWorker(uid, email, ownerId, inviteHash, permissions = workerPermissions()) {
  return {
    uid, email, name: 'V16 Worker', photoURL: '', role: 'worker', permissions, ownerId,
    businessId: ownerId, tenantKey: `owner:${ownerId}:business:${ownerId}`, invitationHash: inviteHash,
    status: 'active', approved: true, isOwner: false, businessLimit: 1, workerLimit: 0,
    approvedFromInvitation: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
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
      await setDoc(doc(db, 'businesses', 'owner-a', 'members', 'worker-a'), membership('worker-a', 'worker-a@example.test', 'owner-a'));
      const expiredStart = Timestamp.fromMillis(Date.now() - 8 * 24 * 60 * 60 * 1000);
      await setDoc(doc(db, 'accountAccess', 'expired-trial'), {
        uid: 'expired-trial', ownerId: 'expired-trial', businessId: 'expired-trial',
        tenantKey: 'owner:expired-trial:business:expired-trial', email: 'expired@example.test', name: 'Expired', status: 'trial', plan: 'normal', trialDays: 7,
        trialStartedAt: expiredStart, lastSeenAt: Timestamp.now(), createdAt: expiredStart, source: 'self_service'
      });
      await setDoc(doc(db, 'businesses', 'expired-trial', 'state', 'main'), state('expired-trial'));
      await setDoc(doc(db, 'accountAccess', 'expired-paid'), {
        uid: 'expired-paid', businessId: 'expired-paid', email: 'expired-paid@example.test', name: 'Expired paid', photoURL: '',
        status: 'paid_base', plan: 'base', planCode: 'base', expiresAt: Timestamp.fromMillis(Date.now() - 1000),
        lastSeenAt: Timestamp.now(), createdAt: expiredStart, source: 'admin_activation', entitlementVersion: 16, revision: 2
      });
      await setDoc(doc(db, 'businesses', 'expired-paid', 'state', 'main'), state('expired-paid'));
      await setDoc(doc(db, 'accountAccess', 'historical-paid'), {
        uid: 'historical-paid', businessId: 'historical-paid', email: 'historical-paid@example.test', name: 'Historical buyer', photoURL: '',
        status: 'paid_base', plan: 'base', planCode: 'base', lastSeenAt: Timestamp.now(), createdAt: expiredStart,
        source: 'historical_buyer_recovery', entitlementVersion: 16, revision: 2
      });
      await setDoc(doc(db, 'businesses', 'historical-paid', 'state', 'main'), state('historical-paid'));
      await setDoc(doc(db, 'accountAccess', 'paid-first-tenant'), {
        uid: 'paid-first-tenant', businessId: 'paid-first-tenant', email: 'paid-first@example.test', name: 'Paid first tenant', photoURL: '',
        status: 'paid_base', plan: 'base', planCode: 'base', lastSeenAt: Timestamp.now(), createdAt: expiredStart,
        source: 'historical_buyer_recovery', entitlementVersion: 16, revision: 1
      });
      await setDoc(doc(db, 'accountAccess', 'legacy-heartbeat'), {
        uid: 'legacy-heartbeat', email: 'legacy-heartbeat@example.test', status: 'paid_base', plan: 'base',
        lastSeenAt: Timestamp.now(), createdAt: expiredStart, source: 'historical_buyer_recovery'
      });
      await setDoc(doc(db, 'adminBackups', 'private-backup'), { uid: 'owner-a', beforeHash: 'secret' });
      await setDoc(doc(db, 'adminAuditLogs', 'private-audit'), { uid: 'owner-a', action: 'activate' });
    });

    const ownerA = env.authenticatedContext('owner-a', { email: 'owner-a@example.test' }).firestore();
    const ownerB = env.authenticatedContext('owner-b', { email: 'owner-b@example.test' }).firestore();
    const workerA = env.authenticatedContext('worker-a', { email: 'worker-a@example.test' }).firestore();
    const notApproved = env.authenticatedContext('active-not-approved', { email: 'not-approved@example.test' }).firestore();
    const attacker = env.authenticatedContext('attacker', { email: 'attacker@example.test' }).firestore();
    const selfWorker = env.authenticatedContext('self-worker', { email: 'self-worker@example.test' }).firestore();
    const trial = env.authenticatedContext('trial-user', { email: 'trial@example.test' }).firestore();
    const legacyTrial = env.authenticatedContext('legacy-trial-user', { email: 'legacy-trial@example.test' }).firestore();
    const expiredTrial = env.authenticatedContext('expired-trial', { email: 'expired@example.test' }).firestore();
    const expiredPaid = env.authenticatedContext('expired-paid', { email: 'expired-paid@example.test' }).firestore();
    const historicalPaid = env.authenticatedContext('historical-paid', { email: 'historical-paid@example.test' }).firestore();
    const paidFirstTenant = env.authenticatedContext('paid-first-tenant', { email: 'paid-first@example.test' }).firestore();
    const legacyHeartbeat = env.authenticatedContext('legacy-heartbeat', { email: 'legacy-heartbeat@example.test' }).firestore();
    const unauthenticated = env.unauthenticatedContext().firestore();
    const stateA = doc(ownerA, 'businesses', 'owner-a', 'state', 'main');
    const stateB = doc(ownerB, 'businesses', 'owner-b', 'state', 'main');
    const trialAccess = doc(trial, 'accountAccess', 'trial-user');
    const legacyTrialAccess = doc(legacyTrial, 'accountAccess', 'legacy-trial-user');
    const trialState = doc(trial, 'businesses', 'trial-user', 'state', 'main');
    const paidFirstState = doc(paidFirstTenant, 'businesses', 'paid-first-tenant', 'state', 'main');

    await assertSucceeds(setDoc(stateA, state('owner-a')));
    await assertSucceeds(getDoc(stateA));
    await assertFails(getDoc(doc(ownerB, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(workerA, 'businesses', 'owner-b', 'state', 'main')));
    await assertFails(getDoc(doc(notApproved, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(unauthenticated, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(getDoc(doc(selfWorker, 'businesses', 'self-worker', 'state', 'main')));
    await assertSucceeds(getDoc(doc(ownerA, 'approvedUsers', 'worker-a')));
    await assertSucceeds(updateDoc(doc(ownerA, 'approvedUsers', 'owner-a'), {
      name: 'Owner A', photoURL: 'https://example.test/owner-a.jpg', updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(ownerA, 'approvedUsers', 'owner-a'), {
      name: 'Owner A', photoURL: '', updatedAt: serverTimestamp(), businessLimit: 999
    }));
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

    await assertSucceeds(setDoc(trialAccess, {
      uid: 'trial-user', ownerId: 'trial-user', businessId: 'trial-user', tenantKey: 'owner:trial-user:business:trial-user', email: 'trial@example.test', name: 'Trial user', photoURL: '',
      status: 'trial', plan: 'normal', planCode: 'base', trialDays: 7,
      trialStartedAt: serverTimestamp(), profileUpdatedAt: serverTimestamp(), lastSeenAt: serverTimestamp(), createdAt: serverTimestamp(),
      source: 'self_service', entitlementVersion: 16, revision: 1
    }));
    await assertSucceeds(getDoc(trialAccess));
    await assertSucceeds(setDoc(legacyTrialAccess, {
      uid: 'legacy-trial-user', ownerId: 'legacy-trial-user', businessId: 'legacy-trial-user', tenantKey: 'owner:legacy-trial-user:business:legacy-trial-user',
      email: 'legacy-trial@example.test', name: 'Legacy trial user', photoURL: '', status: 'trial', plan: 'normal', planCode: 'base', trialDays: 7,
      trialStartedAt: serverTimestamp(), lastSeenAt: serverTimestamp(), createdAt: serverTimestamp(),
      source: 'self_service', entitlementVersion: 16, revision: 1
    }));
    await assertSucceeds(getDoc(legacyTrialAccess));
    await assertFails(setDoc(doc(ownerA, 'accountAccess', 'owner-a'), {
      uid: 'owner-a', ownerId: 'owner-a', businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a',
      email: 'owner-a@example.test', name: 'Owner A', photoURL: '', status: 'trial', plan: 'normal', planCode: 'base', trialDays: 7,
      trialStartedAt: serverTimestamp(), lastSeenAt: serverTimestamp(), createdAt: serverTimestamp(),
      source: 'self_service', entitlementVersion: 16, revision: 1
    }));
    await assertSucceeds(updateDoc(trialAccess, { name: 'Trial user renamed', photoURL: 'https://example.test/profile.jpg', profileUpdatedAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(trialAccess, { lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(trialAccess, { status: 'active', lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(legacyHeartbeat, 'accountAccess', 'legacy-heartbeat'), { lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(legacyHeartbeat, 'accountAccess', 'legacy-heartbeat'), { expiresAt: serverTimestamp(), lastSeenAt: serverTimestamp() }));
    await assertSucceeds(setDoc(trialState, state('trial-user')));
    await assertFails(getDoc(doc(trial, 'businesses', 'demo-click360', 'state', 'main')));
    await assertSucceeds(getDoc(doc(expiredTrial, 'businesses', 'expired-trial', 'state', 'main')));
    await assertFails(setDoc(doc(expiredTrial, 'businesses', 'expired-trial', 'state', 'main'), state('expired-trial', 2)));
    await assertSucceeds(getDoc(doc(expiredPaid, 'businesses', 'expired-paid', 'state', 'main')));
    await assertFails(setDoc(doc(expiredPaid, 'businesses', 'expired-paid', 'state', 'main'), state('expired-paid', 2)));
    await assertSucceeds(setDoc(doc(historicalPaid, 'businesses', 'historical-paid', 'state', 'main'), state('historical-paid', 2)));
    await assertSucceeds(runTransaction(paidFirstTenant, async (transaction) => {
      const current = await transaction.get(paidFirstState);
      assert.equal(current.exists(), false, 'paid account starts without a tenant');
      transaction.set(paidFirstState, state('paid-first-tenant'));
    }));
    await assertSucceeds(getDoc(paidFirstState));
    await assertFails(getDoc(doc(ownerA, 'businesses', 'paid-first-tenant', 'state', 'main')));
    await assertFails(setDoc(paidFirstState, state('owner-a', 2)));
    await assertFails(getDoc(doc(ownerA, 'adminBackups', 'private-backup')));
    await assertFails(getDoc(doc(ownerA, 'adminAuditLogs', 'private-audit')));
    await assertSucceeds(setDoc(doc(ownerA, 'telemetryEvents', 'owner-a-bootstrap'), telemetry('owner-a-bootstrap', 'owner-a')));
    await assertFails(getDoc(doc(ownerA, 'telemetryEvents', 'owner-a-bootstrap')));
    await assertFails(setDoc(doc(ownerA, 'telemetryEvents', 'invalid-event'), telemetry('invalid-event', 'owner-a', 'document_dump')));
    await assertFails(setDoc(doc(ownerA, 'telemetryEvents', 'demo-event'), telemetry('demo-event', 'demo-click360')));

    await assertFails(getDoc(doc(workerA, 'businesses', 'owner-a', 'state', 'main')));
    await assertFails(setDoc(doc(workerA, 'businesses', 'owner-a', 'state', 'main'), state('owner-a', 2)));
    await assertFails(setDoc(doc(attacker, 'approvedUsers', 'attacker'), ownerProfile('attacker', 'attacker@example.test')));

    const v16Email = 'v16-worker@example.test';
    const v16Uid = 'v16-worker';
    const v16Hash = 'a'.repeat(64);
    const v16InviteRef = doc(ownerA, 'businesses', 'owner-a', 'invitations', v16Hash);
    const inviteBatch = writeBatch(ownerA);
    inviteBatch.set(v16InviteRef, {
      inviteHash: v16Hash, email: v16Email, name: 'V16 Worker', role: 'worker', permissions: workerPermissions(),
      ownerId: 'owner-a', businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a', status: 'pending',
      expiresAfterDays: 7, singleUse: true, createdAt: serverTimestamp(), createdBy: 'owner-a', appVersion: '16.2.0'
    });
    inviteBatch.set(doc(ownerA, 'businesses', 'owner-a', 'ownerInviteSecrets', v16Hash), {
      inviteHash: v16Hash, token: 'raw-token-owner-only', email: v16Email, ownerId: 'owner-a', createdAt: serverTimestamp()
    });
    await assertSucceeds(inviteBatch.commit());
    await assertFails(getDoc(doc(attacker, 'businesses', 'owner-a', 'ownerInviteSecrets', v16Hash)));

    const v16Worker = env.authenticatedContext(v16Uid, { email: v16Email }).firestore();
    await assertSucceeds(runTransaction(v16Worker, async (transaction) => {
      const inviteRef = doc(v16Worker, 'businesses', 'owner-a', 'invitations', v16Hash);
      const inviteSnap = await transaction.get(inviteRef);
      assert(inviteSnap.exists(), 'the exact-email worker can read the pending invitation');
      transaction.set(doc(v16Worker, 'businesses', 'owner-a', 'members', v16Uid), {
        uid: v16Uid, email: v16Email, name: 'V16 Worker', role: 'worker', permissions: workerPermissions(), status: 'active',
        ownerId: 'owner-a', businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a', invitationHash: v16Hash,
        acceptedAt: serverTimestamp(), lastAccessAt: serverTimestamp()
      });
      transaction.set(doc(v16Worker, 'approvedUsers', v16Uid), v16ApprovedWorker(v16Uid, v16Email, 'owner-a', v16Hash));
      transaction.update(inviteRef, { status: 'accepted', acceptedBy: v16Uid, acceptedAt: serverTimestamp(), consumed: true });
    }));
    await assertFails(getDoc(doc(v16Worker, 'businesses', 'owner-a', 'state', 'main')));

    const workerProductState = state('owner-a', 3);
    workerProductState.payload.data.products.push({ id: 'product-v16', businessId: 'biz_main', code: 'V16-001' });
    workerProductState.payload.data.auditLogs.push({ id: 'audit-v16', userId: v16Uid, action: 'product_created', createdAt: new Date().toISOString() });
    await assertFails(setDoc(doc(v16Worker, 'businesses', 'owner-a', 'state', 'main'), workerProductState));

    const replay = env.authenticatedContext('v16-replay', { email: v16Email }).firestore();
    await assertFails(setDoc(doc(replay, 'approvedUsers', 'v16-replay'), v16ApprovedWorker('v16-replay', v16Email, 'owner-a', v16Hash)));

    const viewOnly = workerPermissions();
    Object.keys(viewOnly).forEach((module) => Object.keys(viewOnly[module]).forEach((action) => { viewOnly[module][action] = action === 'view'; }));
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', 'viewer-worker'), {
        ...workerProfile('viewer-worker', 'viewer@example.test', 'owner-a'), permissions: viewOnly,
        businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a', invitationHash: 'viewer-hash'
      });
      await setDoc(doc(db, 'businesses', 'owner-a', 'members', 'viewer-worker'), membership('viewer-worker', 'viewer@example.test', 'owner-a'));
      await updateDoc(doc(db, 'businesses', 'owner-a', 'members', 'viewer-worker'), { permissions: viewOnly, invitationHash: 'viewer-hash' });
    });
    const viewerWorker = env.authenticatedContext('viewer-worker', { email: 'viewer@example.test' }).firestore();
    const forbiddenProductState = state('owner-a', 4);
    forbiddenProductState.payload.data.products = [...workerProductState.payload.data.products, { id: 'forbidden', businessId: 'biz_main', code: 'NOPE' }];
    forbiddenProductState.payload.data.auditLogs = [...workerProductState.payload.data.auditLogs, { id: 'audit-nope', userId: 'viewer-worker', action: 'product_created', createdAt: new Date().toISOString() }];
    await assertFails(setDoc(doc(viewerWorker, 'businesses', 'owner-a', 'state', 'main'), forbiddenProductState));

    await assertSucceeds(setDoc(doc(ownerA, 'activationRequests', 'request-owner-a'), {
      requestId: 'request-owner-a', uid: 'owner-a', businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a',
      email: 'owner-a@example.test', businessName: 'Owner A', plan: 'base', period: 'month', price: 40,
      currency: 'USD', requestCode: 'C360-OWNERA', status: 'pending', notes: '', createdAt: serverTimestamp(), appVersion: '16.2.0'
    }));
    await assertSucceeds(setDoc(doc(ownerA, 'legalAcceptances', 'owner-a_2026-07-13'), {
      acceptanceId: 'owner-a_2026-07-13', uid: 'owner-a', businessId: 'owner-a', tenantKey: 'owner:owner-a:business:owner-a',
      termsVersion: '2026-07-13', privacyVersion: '2026-07-13', locale: 'es-EC', source: 'qa',
      acceptedAt: serverTimestamp(), appVersion: '16.2.0'
    }));
    await assertFails(setDoc(doc(ownerA, 'businesses', 'demo-click360', 'state', 'main'), state('demo-click360')));

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
    assert.strictEqual(stored.data().revision, 1, 'worker attempts never change the owner-only tenant snapshot');
    console.log('PASS Firestore emulator: tenant reads/writes, approval, invite, revocation boundaries, and legacy backups');
    console.log('PASS Firestore emulator: trial creation, server-time write window, expired read-only, and demo tenant denial');
    console.log('PASS Firestore emulator: active-but-unapproved and cross-tenant attempts are denied');
    console.log('PASS Firestore emulator: V16 invitations remain isolated and worker access to the monolithic snapshot is denied');
    console.log('PASS Firestore emulator: paid UID can transactionally create only its own first V10 tenant');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
